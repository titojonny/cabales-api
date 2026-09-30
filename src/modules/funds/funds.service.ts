import { FundMovementType, FundRole, GroupRole } from '@prisma/client';
import { requestHash } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import type { DomainEvents } from '../../shared/events.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { CreateFundInput, CreateMovementInput, UpdateFundInput } from './funds.schema.js';
import type { FundsRepository } from './funds.repository.js';

const ALL_ROLES = [GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER] as const;

/**
 * Fondos comunes. Ver: miembros del fondo y OWNER/ADMIN del grupo. Gestionar (movimientos de
 * retiro/ajuste, miembros, archivo): MANAGER del fondo u OWNER/ADMIN del grupo. Aportar: cualquier miembro del fondo.
 */
export class FundsService {
  constructor(
    private readonly repository: FundsRepository,
    private readonly groups: GroupsService,
    private readonly events?: DomainEvents,
  ) {}

  private async access(userId: string, groupId: string, fundId: string) {
    const membership = await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const fund = await this.repository.find(groupId, fundId);
    ensure(fund, 404, 'FUND_NOT_FOUND', 'Fondo no encontrado');
    const fundMember = await this.repository.fundMember(fundId, membership.id);
    const groupManager = membership.role !== GroupRole.MEMBER;
    ensure(fundMember || groupManager, 404, 'FUND_NOT_FOUND', 'Fondo no encontrado');
    return {
      fund,
      membership,
      fundMember,
      canManage: groupManager || fundMember?.role === FundRole.MANAGER,
      role: fundMember?.role ?? null,
    };
  }

  private async requireManage(userId: string, groupId: string, fundId: string) {
    const context = await this.access(userId, groupId, fundId);
    if (!context.canManage)
      throw new AppError(403, 'FUND_FORBIDDEN', 'Solo quien administra el fondo puede hacerlo');
    return context;
  }

  async create(userId: string, groupId: string, input: CreateFundInput, requestId: string) {
    const membership = await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const group = await this.repository.groupCurrency(groupId);
    ensure(group, 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    const memberIds = [...new Set(input.memberIds)];
    const found = await this.repository.groupMembers(groupId, memberIds);
    ensure(
      found.length === memberIds.length,
      422,
      'PARTICIPANT_OUTSIDE_GROUP',
      'Un miembro no pertenece al grupo',
    );
    try {
      const fund = await this.repository.create({
        groupId,
        userId,
        creatorMemberId: membership.id,
        name: input.name,
        description: input.description,
        currency: group.currency,
        memberIds,
        requestId,
      });
      return { ...fund, balanceCents: 0, myRole: FundRole.MANAGER, canManage: true };
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new AppError(409, 'FUND_NAME_TAKEN', 'Ya existe un fondo con ese nombre en el grupo');
      }
      throw error;
    }
  }

  async list(userId: string, groupId: string) {
    const membership = await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const groupManager = membership.role !== GroupRole.MEMBER;
    const funds = await this.repository.list(groupId, membership.id, groupManager);
    const balances = await this.repository.balances(funds.map((fund) => fund.id));
    return funds.map(({ members, _count, ...fund }) => ({
      ...fund,
      balanceCents: balances.get(fund.id) ?? 0,
      memberCount: _count.members,
      movementCount: _count.movements,
      myRole: members[0]?.role ?? null,
      canManage: groupManager || members[0]?.role === FundRole.MANAGER,
    }));
  }

  async detail(userId: string, groupId: string, fundId: string) {
    const context = await this.access(userId, groupId, fundId);
    const [{ members, totals }, balances] = await Promise.all([
      this.repository.detail(fundId),
      this.repository.balances([fundId]),
    ]);
    const byType = Object.fromEntries(
      Object.values(FundMovementType).map((type) => {
        const row = totals.find((total) => total.type === type);
        return [type, { totalCents: row?._sum.amountCents ?? 0, count: row?._count ?? 0 }];
      }),
    );
    return {
      ...context.fund,
      balanceCents: balances.get(fundId) ?? 0,
      myRole: context.role,
      canManage: context.canManage,
      canContribute: Boolean(context.fundMember) && !context.fund.archivedAt,
      totals: byType,
      members: members.map((member) => ({
        id: member.id,
        role: member.role,
        joinedAt: member.joinedAt,
        groupMemberId: member.groupMember.id,
        user: member.groupMember.user,
      })),
    };
  }

  async update(userId: string, groupId: string, fundId: string, input: UpdateFundInput) {
    await this.requireManage(userId, groupId, fundId);
    try {
      return await this.repository.update(fundId, {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new AppError(409, 'FUND_NAME_TAKEN', 'Ya existe un fondo con ese nombre en el grupo');
      }
      throw error;
    }
  }

  async archive(userId: string, groupId: string, fundId: string) {
    const { fund } = await this.requireManage(userId, groupId, fundId);
    ensure(!fund.archivedAt, 409, 'FUND_ARCHIVED', 'El fondo ya esta archivado');
    const balance = (await this.repository.balances([fundId])).get(fundId) ?? 0;
    ensure(
      balance === 0,
      409,
      'FUND_BALANCE_NOT_ZERO',
      'Retira o ajusta el saldo a cero antes de archivar',
    );
    return this.repository.update(fundId, { archivedAt: new Date() });
  }

  async addMember(
    userId: string,
    groupId: string,
    fundId: string,
    groupMemberId: string,
    role: FundRole,
  ) {
    await this.requireManage(userId, groupId, fundId);
    const found = await this.repository.groupMembers(groupId, [groupMemberId]);
    ensure(
      found.length === 1,
      422,
      'PARTICIPANT_OUTSIDE_GROUP',
      'La persona no pertenece al grupo',
    );
    ensure(
      !(await this.repository.fundMember(fundId, groupMemberId)),
      409,
      'FUND_MEMBER_EXISTS',
      'Ya es miembro del fondo',
    );
    return this.repository.addMember(fundId, groupMemberId, role);
  }

  async updateMember(
    userId: string,
    groupId: string,
    fundId: string,
    memberId: string,
    role: FundRole,
  ) {
    await this.requireManage(userId, groupId, fundId);
    const member = await this.repository.findMember(fundId, memberId);
    ensure(member, 404, 'FUND_MEMBER_NOT_FOUND', 'Miembro no encontrado');
    if (member.role === FundRole.MANAGER && role !== FundRole.MANAGER) {
      ensure(
        (await this.repository.countManagers(fundId)) > 1,
        409,
        'LAST_MANAGER',
        'El fondo necesita al menos un administrador',
      );
    }
    await this.repository.updateMember(fundId, memberId, role);
    return { ...member, role };
  }

  /** Gestores retiran a otros; cualquier miembro puede salir por sí mismo. */
  async removeMember(userId: string, groupId: string, fundId: string, memberId: string) {
    const context = await this.access(userId, groupId, fundId);
    const member = await this.repository.findMember(fundId, memberId);
    ensure(member, 404, 'FUND_MEMBER_NOT_FOUND', 'Miembro no encontrado');
    const self = member.groupMemberId === context.membership.id;
    if (!self && !context.canManage)
      throw new AppError(403, 'FUND_FORBIDDEN', 'Solo quien administra el fondo puede hacerlo');
    if (member.role === FundRole.MANAGER) {
      ensure(
        (await this.repository.countManagers(fundId)) > 1,
        409,
        'LAST_MANAGER',
        'El fondo necesita al menos un administrador',
      );
    }
    await this.repository.removeMember(fundId, memberId);
  }

  async movements(
    userId: string,
    groupId: string,
    fundId: string,
    cursor: string | undefined,
    limit: number,
  ) {
    await this.access(userId, groupId, fundId);
    const rows = await this.repository.movements(fundId, cursor, limit);
    const items = rows.slice(0, limit);
    return { items, nextCursor: rows.length > limit ? (items.at(-1)?.id ?? null) : null };
  }

  async createMovement(
    userId: string,
    groupId: string,
    fundId: string,
    input: CreateMovementInput,
    key: string,
    requestId: string,
  ) {
    const context = await this.access(userId, groupId, fundId);
    if (input.type === 'CONTRIBUTION') {
      ensure(context.fundMember, 403, 'FUND_FORBIDDEN', 'Solo miembros del fondo pueden aportar');
    } else if (!context.canManage) {
      throw new AppError(
        403,
        'FUND_FORBIDDEN',
        'Solo quien administra el fondo registra retiros o ajustes',
      );
    }
    const hash = requestHash(input);
    const signed = input.type === 'WITHDRAWAL' ? -input.amountCents : input.amountCents;
    const result = await this.repository.createMovementAtomic({
      fundId,
      userId,
      type: input.type as FundMovementType,
      signedAmountCents: signed,
      description: input.description,
      key,
      requestHash: hash,
      requestId,
    });
    ensure(result.outcome !== 'NOT_FOUND', 404, 'FUND_NOT_FOUND', 'Fondo no encontrado');
    ensure(result.outcome !== 'ARCHIVED', 409, 'FUND_ARCHIVED', 'El fondo esta archivado');
    ensure(
      result.outcome !== 'INSUFFICIENT',
      409,
      'INSUFFICIENT_FUNDS',
      'El saldo del fondo no alcanza',
    );
    ensure(
      result.outcome !== 'OVERFLOW',
      422,
      'MONEY_OVERFLOW',
      'El saldo excede el rango permitido',
    );
    ensure(
      result.requestHash === hash,
      409,
      'IDEMPOTENCY_CONFLICT',
      'La llave ya se uso con otra solicitud',
    );
    if (result.outcome === 'CREATED') {
      this.events?.emit({
        type: 'fund.movement',
        groupId,
        fundId,
        movementId: result.data.movement.id,
        userId,
      });
    }
    return { data: result.data, replayed: result.outcome === 'REPLAY' };
  }
}
