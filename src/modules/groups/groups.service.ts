import { GroupRole, InvitationStatus } from '@prisma/client';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import { assertCurrency } from '../../shared/money.js';
import type { CreateGroupInput, InviteInput, UpdateGroupInput } from './groups.schema.js';
import type { GroupsRepository } from './groups.repository.js';

/** Membresía mínima utilizada por decisiones RBAC. */
export interface Membership {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
}

/** Reglas RBAC y ciclo de vida de grupos. */
export class GroupsService {
  constructor(private readonly repository: GroupsRepository) {}

  create(userId: string, input: CreateGroupInput) {
    assertCurrency(input.currency);
    return this.repository.create(userId, input);
  }

  list(userId: string) {
    return this.repository.list(userId);
  }

  async detail(userId: string, groupId: string) {
    await this.requireRole(userId, groupId, [GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER]);
    const group = await this.repository.detail(groupId);
    ensure(group, 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    return group;
  }

  async update(userId: string, groupId: string, input: UpdateGroupInput) {
    await this.requireRole(userId, groupId, [GroupRole.OWNER, GroupRole.ADMIN]);
    if (input.currency) assertCurrency(input.currency);
    const result = await this.repository.updateAtomic(groupId, input);
    ensure(result.outcome !== 'NOT_FOUND', 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    ensure(
      result.outcome !== 'CURRENCY_LOCKED',
      409,
      'CURRENCY_LOCKED',
      'No se cambia la moneda de un grupo con gastos',
    );
    return result.group;
  }

  async delete(userId: string, groupId: string): Promise<void> {
    await this.requireRole(userId, groupId, [GroupRole.OWNER]);
    const outcome = await this.repository.deleteEmptyAtomic(groupId);
    ensure(outcome !== 'NOT_FOUND', 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    ensure(
      outcome !== 'NOT_EMPTY',
      409,
      'GROUP_NOT_EMPTY',
      'No se elimina un grupo con actividad financiera',
    );
  }

  async invite(userId: string, groupId: string, input: InviteInput) {
    await this.requireRole(userId, groupId, [GroupRole.OWNER, GroupRole.ADMIN]);
    const token = randomToken();
    const invitation = await this.repository.createInvitation({
      groupId,
      invitedById: userId,
      email: input.email,
      role: input.role as GroupRole,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });
    return { invitation, token };
  }

  async accept(userId: string, userEmail: string, token: string) {
    const invitation = await this.repository.findInvitation(hashToken(token));
    ensure(invitation, 404, 'INVITATION_NOT_FOUND', 'Invitacion no encontrada');
    ensure(
      invitation.status === InvitationStatus.PENDING,
      409,
      'INVITATION_USED',
      'La invitacion ya no esta disponible',
    );
    ensure(
      invitation.expiresAt.getTime() > Date.now(),
      410,
      'INVITATION_EXPIRED',
      'La invitacion expiro',
    );
    ensure(
      invitation.email === userEmail,
      403,
      'INVITATION_EMAIL_MISMATCH',
      'La invitacion pertenece a otro correo',
    );
    const membership = await this.repository.acceptInvitation(
      invitation.id,
      invitation.groupId,
      userId,
      invitation.role,
    );
    ensure(membership, 409, 'INVITATION_USED', 'La invitacion ya no esta disponible');
    return membership;
  }

  /** Aplica mínimo privilegio y devuelve la membresía para validaciones de contexto. */
  async requireRole(
    userId: string,
    groupId: string,
    roles: readonly GroupRole[],
  ): Promise<Membership> {
    const membership = await this.repository.membership(groupId, userId);
    ensure(membership, 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    if (!roles.includes(membership.role)) {
      throw new AppError(403, 'FORBIDDEN', 'El rol no permite esta operacion');
    }
    return membership;
  }
}
