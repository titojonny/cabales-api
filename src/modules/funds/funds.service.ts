import { FundMovementType, FundRole, GroupRole } from '@prisma/client';
import { requestHash } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import type { DomainEvents } from '../../shared/events.js';
import type { GroupsService } from '../groups/groups.service.js';
import type {
  ContributionRequestsQuery,
  CreateContributionRequestInput,
  CreateFundInput,
  CreateMovementInput,
  UpdateFundInput,
} from './funds.schema.js';
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
    await this.repository.markOverdue(new Date());
    const contributionRequests = await this.repository.contributionRequestMembers(
      fundId,
      'ALL',
      100,
    );
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
      contributionRequests: contributionRequests.map((item) => ({
        id: item.id,
        requestId: item.request.id,
        dueAt: item.request.dueAt,
        amountCents: item.amountCents,
        status: item.status,
        paidAt: item.paidAt,
        fundMemberId: item.fundMember.id,
        groupMemberId: item.fundMember.groupMemberId,
        user: item.fundMember.groupMember.user,
      })),
    };
  }

  async createContributionRequest(
    userId: string,
    groupId: string,
    fundId: string,
    input: CreateContributionRequestInput,
    requestId: string,
  ) {
    const context = await this.requireManage(userId, groupId, fundId);
    ensure(!context.fund.archivedAt, 409, 'FUND_ARCHIVED', 'El fondo esta archivado');
    const dueAt = new Date(input.dueAt);
    ensure(
      dueAt.getTime() > Date.now(),
      422,
      'CONTRIBUTION_DUE_DATE_INVALID',
      'La fecha limite debe estar en el futuro',
    );
    ensure(
      dueAt.getTime() <= Date.now() + 366 * 24 * 60 * 60 * 1000,
      422,
      'CONTRIBUTION_DUE_DATE_TOO_FAR',
      'La fecha limite no puede superar un ano',
    );
    const memberIds = input.members.map((member) => member.fundMemberId);
    ensure(
      new Set(memberIds).size === memberIds.length,
      422,
      'DUPLICATE_FUND_MEMBER',
      'No repitas integrantes en una solicitud',
    );
    const found = await this.repository.fundMembers(fundId, memberIds);
    ensure(
      found.length === memberIds.length,
      422,
      'FUND_MEMBER_NOT_FOUND',
      'Un integrante no pertenece al fondo',
    );
    return this.repository.createContributionRequest({
      fundId,
      createdById: userId,
      dueAt,
      members: input.members,
      requestId,
    });
  }

  async contributionRequests(
    userId: string,
    groupId: string,
    fundId: string,
    query: ContributionRequestsQuery,
  ) {
    await this.access(userId, groupId, fundId);
    await this.repository.markOverdue(new Date());
    const rows = await this.repository.contributionRequestMembers(
      fundId,
      query.status,
      query.limit,
    );
    return rows.map((item) => ({
      id: item.id,
      requestId: item.request.id,
      dueAt: item.request.dueAt,
      createdAt: item.request.createdAt,
      amountCents: item.amountCents,
      status: item.status,
      paidAt: item.paidAt,
      fundMemberId: item.fundMember.id,
      groupMemberId: item.fundMember.groupMemberId,
      user: item.fundMember.groupMember.user,
    }));
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
    const context = await this.requireManage(userId, groupId, fundId);
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
    let contributionRequestMemberId: string | undefined;
    if (input.type === 'CONTRIBUTION') {
      ensure(context.fundMember, 403, 'FUND_FORBIDDEN', 'Solo miembros del fondo pueden aportar');
      if (input.contributionRequestMemberId) {
        const requestMember = await this.repository.requestMember(
          fundId,
          input.contributionRequestMemberId,
        );
        ensure(
          requestMember && requestMember.fundMemberId === context.fundMember.id,
          404,
          'CONTRIBUTION_REQUEST_NOT_FOUND',
          'Solicitud de aporte no encontrada',
        );
        ensure(
          requestMember.status === 'PENDING' || requestMember.status === 'OVERDUE',
          409,
          'CONTRIBUTION_REQUEST_PAID',
          'El aporte solicitado ya fue registrado',
        );
        ensure(
          requestMember.amountCents === input.amountCents,
          422,
          'CONTRIBUTION_AMOUNT_MISMATCH',
          'El aporte no coincide con el importe solicitado',
        );
        contributionRequestMemberId = requestMember.id;
      } else {
        const matching = await this.repository.openRequestMemberForUser(
          fundId,
          userId,
          input.amountCents,
        );
        contributionRequestMemberId = matching?.id;
      }
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
      ...(contributionRequestMemberId ? { contributionRequestMemberId } : {}),
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
