import { FundAccessPolicy, FundMovementType, FundRole, GroupRole } from '@prisma/client';
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

  private policyAllows(
    policy: FundAccessPolicy,
    groupRole: GroupRole,
    fundRole: FundRole | null,
  ): boolean {
    if (policy === FundAccessPolicy.GROUP_ADMINS) return groupRole !== GroupRole.MEMBER;
    if (policy === FundAccessPolicy.MANAGERS)
      return groupRole !== GroupRole.MEMBER || fundRole === FundRole.MANAGER;
    return fundRole !== null;
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
        contributionPolicy: input.contributionPolicy,
        withdrawalPolicy: input.withdrawalPolicy,
        closingPolicy: input.closingPolicy,
        withdrawalLimitCents: input.withdrawalLimitCents ?? null,
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
      canContribute:
        !context.fund.archivedAt &&
        this.policyAllows(
          context.fund.contributionPolicy ?? FundAccessPolicy.ANY_MEMBER,
          context.membership.role,
          context.fundMember?.role ?? null,
        ),
      canWithdraw:
        !context.fund.archivedAt &&
        this.policyAllows(
          context.fund.withdrawalPolicy ?? FundAccessPolicy.MANAGERS,
          context.membership.role,
          context.fundMember?.role ?? null,
        ),
      canClose:
        !context.fund.archivedAt &&
        this.policyAllows(
          context.fund.closingPolicy ?? FundAccessPolicy.MANAGERS,
          context.membership.role,
          context.fundMember?.role ?? null,
        ),
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
        ...(input.contributionPolicy !== undefined ? { contributionPolicy: input.contributionPolicy } : {}),
        ...(input.withdrawalPolicy !== undefined ? { withdrawalPolicy: input.withdrawalPolicy } : {}),
        ...(input.closingPolicy !== undefined ? { closingPolicy: input.closingPolicy } : {}),
        ...(input.withdrawalLimitCents !== undefined ? { withdrawalLimitCents: input.withdrawalLimitCents } : {}),
      });
    } catch (error) {
      if ((error as { code?: string })?.code === 'P2002') {
        throw new AppError(409, 'FUND_NAME_TAKEN', 'Ya existe un fondo con ese nombre en el grupo');
      }
      throw error;
    }
  }

  async archive(userId: string, groupId: string, fundId: string) {
    const context = await this.access(userId, groupId, fundId);
    ensure(
      this.policyAllows(context.fund.closingPolicy ?? FundAccessPolicy.MANAGERS, context.membership.role, context.fundMember?.role ?? null),
      403,
      'FUND_FORBIDDEN',
      'No tienes permiso para cerrar este fondo',
    );
    const result = await this.repository.archiveAtomic(fundId);
    ensure(result.outcome !== 'NOT_FOUND', 404, 'FUND_NOT_FOUND', 'Fondo no encontrado');
    ensure(
      result.outcome !== 'ALREADY_ARCHIVED',
      409,
      'FUND_ARCHIVED',
      'El fondo ya esta archivado',
    );
    ensure(
      result.outcome !== 'NON_ZERO',
      409,
      'FUND_BALANCE_NOT_ZERO',
      'Retira o ajusta el saldo a cero antes de archivar',
    );
    return {
      ...result.fund,
      balanceCents: 0,
      myRole: context.role,
      canManage: context.canManage,
    };
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
    const result = await this.repository.updateMemberAtomic(fundId, memberId, role);
    ensure(result.outcome !== 'NOT_FOUND', 404, 'FUND_MEMBER_NOT_FOUND', 'Miembro no encontrado');
    ensure(
      result.outcome !== 'LAST_MANAGER',
      409,
      'LAST_MANAGER',
      'El fondo necesita al menos un administrador',
    );
    return result.member;
  }

  /** Gestores retiran a otros; cualquier miembro puede salir por sí mismo. */
  async removeMember(userId: string, groupId: string, fundId: string, memberId: string) {
    const context = await this.access(userId, groupId, fundId);
    const member = await this.repository.findMember(fundId, memberId);
    ensure(member, 404, 'FUND_MEMBER_NOT_FOUND', 'Miembro no encontrado');
    const self = member.groupMemberId === context.membership.id;
    if (!self && !context.canManage)
      throw new AppError(403, 'FUND_FORBIDDEN', 'Solo quien administra el fondo puede hacerlo');
    const result = await this.repository.removeMemberAtomic(fundId, memberId);
    ensure(result.outcome !== 'NOT_FOUND', 404, 'FUND_MEMBER_NOT_FOUND', 'Miembro no encontrado');
    ensure(
      result.outcome !== 'LAST_MANAGER',
      409,
      'LAST_MANAGER',
      'El fondo necesita al menos un administrador',
    );
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
      ensure(
        !context.fund.archivedAt &&
          this.policyAllows(context.fund.contributionPolicy ?? FundAccessPolicy.ANY_MEMBER, context.membership.role, context.fundMember?.role ?? null),
        403,
        'FUND_FORBIDDEN',
        'No tienes permiso para aportar a este fondo',
      );
    } else if (input.type === 'WITHDRAWAL') {
      ensure(
        this.policyAllows(context.fund.withdrawalPolicy ?? FundAccessPolicy.MANAGERS, context.membership.role, context.fundMember?.role ?? null),
        403,
        'FUND_FORBIDDEN',
        'No tienes permiso para retirar de este fondo',
      );
      ensure(
        context.fund.withdrawalLimitCents === null || input.amountCents <= context.fund.withdrawalLimitCents,
        422,
        'WITHDRAWAL_LIMIT_EXCEEDED',
        'El retiro supera el limite configurado para este fondo',
      );
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
