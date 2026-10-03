import { GroupRole, InvitationStatus } from '@prisma/client';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import { assertCurrency } from '../../shared/money.js';
import type { DomainEvents } from '../../shared/events.js';
import { emailTemplates, type EmailProvider } from '../../infrastructure/email.js';
import type { BackgroundTasks } from '../../infrastructure/background.js';
import type {
  CreateCategoryInput,
  CreateGroupInput,
  InviteInput,
  UpdateGroupInput,
} from './groups.schema.js';
import type { GroupsRepository } from './groups.repository.js';

/** Membresía mínima utilizada por decisiones RBAC. */
export interface Membership {
  id: string;
  groupId: string;
  userId: string;
  role: GroupRole;
}

/** Colaboradores opcionales para envío de invitaciones y hechos de dominio. */
export interface GroupsCollaborators {
  email?: EmailProvider;
  background?: BackgroundTasks;
  events?: DomainEvents;
  appOrigin?: string;
  invitationTtlMs?: number;
}

const ALL_ROLES = [GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER] as const;
const MANAGERS = [GroupRole.OWNER, GroupRole.ADMIN] as const;

/** Reglas RBAC y ciclo de vida de grupos. */
export class GroupsService {
  private readonly invitationTtlMs: number;

  constructor(
    private readonly repository: GroupsRepository,
    private readonly collaborators: GroupsCollaborators = {},
  ) {
    this.invitationTtlMs = collaborators.invitationTtlMs ?? 7 * 24 * 60 * 60 * 1000;
  }

  async create(userId: string, input: CreateGroupInput) {
    assertCurrency(input.currency);
    const group = await this.repository.create(userId, input);
    this.collaborators.events?.emit({ type: 'group.created', groupId: group.id, userId });
    return group;
  }

  list(userId: string) {
    return this.repository.list(userId);
  }

  async detail(userId: string, groupId: string) {
    await this.requireRole(userId, groupId, ALL_ROLES);
    const group = await this.repository.detail(groupId);
    ensure(group, 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    return group;
  }

  async update(userId: string, groupId: string, input: UpdateGroupInput) {
    await this.requireRole(userId, groupId, MANAGERS);
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

  async invite(userId: string, groupId: string, input: InviteInput, requestId = 'internal') {
    await this.requireRole(userId, groupId, MANAGERS);
    await this.repository.expireStale(groupId);
    ensure(
      !(await this.repository.isMemberEmail(groupId, input.email)),
      409,
      'ALREADY_MEMBER',
      'Esa persona ya pertenece al grupo',
    );
    ensure(
      !(await this.repository.findPendingByEmail(groupId, input.email)),
      409,
      'INVITATION_PENDING',
      'Ya existe una invitacion pendiente para ese correo; reenviala o revocala',
    );
    const token = randomToken();
    const invitation = await this.repository.createInvitation({
      groupId,
      invitedById: userId,
      email: input.email,
      role: input.role as GroupRole,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.invitationTtlMs),
      requestId,
    });
    this.deliverInvitation(groupId, userId, input.email, token);
    this.collaborators.events?.emit({
      type: 'invitation.created',
      groupId,
      invitationId: invitation.id,
      email: input.email,
      userId,
    });
    // El token solo se devuelve a quien invita para compartir el enlace manualmente; se guarda como hash.
    return { invitation, token, delivery: this.deliveryMode() };
  }

  async listInvitations(userId: string, groupId: string, status?: InvitationStatus) {
    await this.requireRole(userId, groupId, MANAGERS);
    await this.repository.expireStale(groupId);
    return this.repository.listInvitations(groupId, status);
  }

  async resendInvitation(userId: string, groupId: string, invitationId: string, requestId: string) {
    await this.requireRole(userId, groupId, MANAGERS);
    await this.repository.expireStale(groupId);
    const current = await this.repository.findInvitationInGroup(groupId, invitationId);
    ensure(current, 404, 'INVITATION_NOT_FOUND', 'Invitacion no encontrada');
    // Una invitación vencida se reactiva con un token nuevo; aceptadas o revocadas son terminales.
    ensure(
      current.status === InvitationStatus.PENDING || current.status === InvitationStatus.EXPIRED,
      409,
      'INVITATION_USED',
      'La invitacion ya no esta disponible',
    );
    if (current.status === InvitationStatus.EXPIRED) {
      ensure(
        !(await this.repository.isMemberEmail(groupId, current.email)),
        409,
        'ALREADY_MEMBER',
        'Esa persona ya pertenece al grupo',
      );
      await this.repository.reopenExpired(invitationId);
    }
    const token = randomToken();
    const invitation = await this.repository.rotateInvitation({
      invitationId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.invitationTtlMs),
      userId,
      requestId,
    });
    ensure(invitation, 409, 'INVITATION_USED', 'La invitacion ya no esta disponible');
    this.deliverInvitation(groupId, userId, invitation.email, token);
    return { invitation, token, delivery: this.deliveryMode() };
  }

  async revokeInvitation(userId: string, groupId: string, invitationId: string, requestId: string) {
    await this.requireRole(userId, groupId, MANAGERS);
    const current = await this.repository.findInvitationInGroup(groupId, invitationId);
    ensure(current, 404, 'INVITATION_NOT_FOUND', 'Invitacion no encontrada');
    const revoked = await this.repository.revokeInvitation(invitationId, userId, requestId);
    ensure(revoked, 409, 'INVITATION_USED', 'Solo se revocan invitaciones pendientes');
    return revoked;
  }

  /** Vista previa segura para quien recibió el enlace; no revela el correo destinatario completo. */
  async previewInvitation(userEmail: string, token: string) {
    const invitation = await this.repository.findInvitation(hashToken(token));
    ensure(invitation, 404, 'INVITATION_NOT_FOUND', 'Invitacion no encontrada');
    const expired =
      invitation.status === InvitationStatus.PENDING &&
      invitation.expiresAt.getTime() <= Date.now();
    return {
      groupName: invitation.group.name,
      invitedBy: invitation.invitedBy.displayName,
      role: invitation.role,
      status: expired ? InvitationStatus.EXPIRED : invitation.status,
      expiresAt: invitation.expiresAt,
      emailMatches: invitation.email === userEmail,
    };
  }

  async accept(userId: string, userEmail: string, token: string, requestId = 'internal') {
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
      requestId,
    );
    ensure(membership, 409, 'INVITATION_USED', 'La invitacion ya no esta disponible');
    this.collaborators.events?.emit({
      type: 'invitation.accepted',
      groupId: invitation.groupId,
      invitationId: invitation.id,
      userId,
      inviterId: invitation.invitedById,
    });
    return membership;
  }

  async listCategories(userId: string, groupId: string) {
    await this.requireRole(userId, groupId, ALL_ROLES);
    return this.repository.listCategories(groupId);
  }

  async createCategory(userId: string, groupId: string, input: CreateCategoryInput) {
    await this.requireRole(userId, groupId, MANAGERS);
    try {
      return await this.repository.createCategory(groupId, input);
    } catch (error) {
      if (error && typeof error === 'object' && (error as { code?: string }).code === 'P2002') {
        throw new AppError(409, 'CATEGORY_EXISTS', 'Ya existe una categoria con ese nombre');
      }
      throw error;
    }
  }

  async deleteCategory(userId: string, groupId: string, categoryId: string) {
    await this.requireRole(userId, groupId, MANAGERS);
    const result = await this.repository.deleteCategory(groupId, categoryId);
    ensure(result.count === 1, 404, 'CATEGORY_NOT_FOUND', 'Categoria no encontrada');
  }

  /** Comprueba que una categoría sea del grupo o global. */
  async assertCategory(groupId: string, categoryId: string) {
    ensure(
      await this.repository.findCategory(groupId, categoryId),
      422,
      'CATEGORY_OUTSIDE_GROUP',
      'La categoria no pertenece al grupo',
    );
  }

  async assertTags(groupId: string, tagIds: string[]) {
    ensure(
      (await this.repository.tagsInGroup(groupId, tagIds)).length === tagIds.length,
      422,
      'TAG_OUTSIDE_GROUP',
      'Una etiqueta no pertenece al grupo',
    );
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

  private deliveryMode(): 'email' | 'manual' {
    return this.collaborators.email && this.collaborators.email.name !== 'logging'
      ? 'email'
      : 'manual';
  }

  private deliverInvitation(groupId: string, inviterId: string, email: string, token: string) {
    const { email: provider, background, appOrigin } = this.collaborators;
    if (!provider || !background || !appOrigin) return;
    background.run('invitation.email', async () => {
      const [group, inviter] = await Promise.all([
        this.repository.groupSummary(groupId),
        this.repository.userDisplayName(inviterId),
      ]);
      if (!group) return;
      await provider.send({
        to: email,
        ...emailTemplates.invitation(
          appOrigin,
          token,
          group.name,
          inviter?.displayName ?? 'Alguien',
          Math.round(this.invitationTtlMs / 86_400_000),
        ),
      });
    });
  }
}
