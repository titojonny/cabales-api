import type { FundMovementType } from '@prisma/client';
import { FundRole, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { withSerializableRetry } from '../../database/transaction.js';
import { isIdempotencyActive } from '../../shared/idempotency.js';

const fundView = {
  id: true,
  groupId: true,
  name: true,
  description: true,
  currency: true,
  archivedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const movementView = {
  id: true,
  type: true,
  amountCents: true,
  description: true,
  createdAt: true,
  createdBy: { select: { id: true, displayName: true } },
} as const;

const contributionRequestView = {
  id: true,
  dueAt: true,
  createdAt: true,
  members: {
    select: {
      id: true,
      amountCents: true,
      status: true,
      paidAt: true,
      fundMember: {
        select: {
          id: true,
          groupMemberId: true,
          groupMember: { select: { user: { select: { id: true, displayName: true } } } },
        },
      },
    },
    orderBy: { fundMember: { groupMemberId: 'asc' as const } },
  },
} as const;

/** Persistencia de fondos; el saldo siempre se deriva de movimientos inmutables. */
export class FundsRepository {
  constructor(private readonly db: Database) {}

  groupCurrency(groupId: string) {
    return this.db.group.findUnique({ where: { id: groupId }, select: { currency: true } });
  }

  groupMembers(groupId: string, ids: string[]) {
    return this.db.groupMember.findMany({
      where: { groupId, id: { in: ids } },
      select: { id: true },
    });
  }

  create(input: {
    groupId: string;
    userId: string;
    creatorMemberId: string;
    name: string;
    description?: string | undefined;
    currency: string;
    memberIds: string[];
    requestId: string;
  }) {
    return this.db.$transaction(async (tx) => {
      const fund = await tx.fund.create({
        data: {
          groupId: input.groupId,
          name: input.name,
          currency: input.currency,
          createdById: input.userId,
          ...(input.description ? { description: input.description } : {}),
          members: {
            create: [
              { groupMemberId: input.creatorMemberId, role: FundRole.MANAGER },
              ...input.memberIds
                .filter((id) => id !== input.creatorMemberId)
                .map((groupMemberId) => ({ groupMemberId, role: FundRole.MEMBER })),
            ],
          },
        },
        select: fundView,
      });
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'fund.created',
          entityType: 'Fund',
          entityId: fund.id,
          requestId: input.requestId,
          metadata: { groupId: input.groupId },
        },
      });
      return fund;
    });
  }

  find(groupId: string, fundId: string) {
    return this.db.fund.findFirst({ where: { id: fundId, groupId }, select: fundView });
  }

  fundMember(fundId: string, groupMemberId: string) {
    return this.db.fundMember.findUnique({
      where: { fundId_groupMemberId: { fundId, groupMemberId } },
      select: { id: true, role: true },
    });
  }

  async balances(fundIds: string[]) {
    if (fundIds.length === 0) return new Map<string, number>();
    const rows = await this.db.fundMovement.groupBy({
      by: ['fundId'],
      where: { fundId: { in: fundIds } },
      _sum: { amountCents: true },
    });
    return new Map(rows.map((row) => [row.fundId, row._sum.amountCents ?? 0]));
  }

  list(groupId: string, groupMemberId: string, includeAll: boolean) {
    return this.db.fund.findMany({
      where: { groupId, ...(includeAll ? {} : { members: { some: { groupMemberId } } }) },
      select: {
        ...fundView,
        members: { where: { groupMemberId }, select: { role: true } },
        _count: { select: { members: true, movements: true } },
      },
      orderBy: [{ archivedAt: { sort: 'asc', nulls: 'first' } }, { createdAt: 'desc' }],
      take: 100,
    });
  }

  async detail(fundId: string) {
    const [members, totals] = await Promise.all([
      this.db.fundMember.findMany({
        where: { fundId },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          groupMember: {
            select: {
              id: true,
              user: { select: { id: true, displayName: true, avatarUrl: true } },
            },
          },
        },
        orderBy: { joinedAt: 'asc' },
      }),
      this.db.fundMovement.groupBy({
        by: ['type'],
        where: { fundId },
        _sum: { amountCents: true },
        _count: true,
      }),
    ]);
    return { members, totals };
  }

  fundMembers(fundId: string, ids: string[]) {
    return this.db.fundMember.findMany({
      where: { fundId, id: { in: ids } },
      select: { id: true },
    });
  }

  createContributionRequest(input: {
    fundId: string;
    createdById: string;
    dueAt: Date;
    members: Array<{ fundMemberId: string; amountCents: number }>;
    requestId: string;
  }) {
    return this.db.$transaction(async (tx) => {
      const request = await tx.fundContributionRequest.create({
        data: {
          fundId: input.fundId,
          createdById: input.createdById,
          dueAt: input.dueAt,
          members: {
            create: input.members.map(({ fundMemberId, amountCents }) => ({
              amountCents,
              fundMember: { connect: { id: fundMemberId } },
            })),
          },
        },
        select: contributionRequestView,
      });
      await tx.auditLog.create({
        data: {
          userId: input.createdById,
          action: 'fund.contribution_request_created',
          entityType: 'FundContributionRequest',
          entityId: request.id,
          requestId: input.requestId,
          metadata: { fundId: input.fundId, dueAt: input.dueAt.toISOString() },
        },
      });
      return request;
    });
  }

  contributionRequestMembers(fundId: string, status: string, limit: number) {
    return this.db.fundContributionRequestMember.findMany({
      where: {
        request: { fundId },
        ...(status === 'ALL' ? {} : { status }),
      },
      select: {
        id: true,
        amountCents: true,
        status: true,
        paidAt: true,
        request: { select: { id: true, dueAt: true, createdAt: true } },
        fundMember: {
          select: {
            id: true,
            groupMemberId: true,
            groupMember: { select: { user: { select: { id: true, displayName: true } } } },
          },
        },
      },
      orderBy: [{ request: { dueAt: 'asc' } }, { id: 'asc' }],
      take: limit,
    });
  }

  markOverdue(now: Date) {
    return this.db.fundContributionRequestMember.updateMany({
      where: { status: 'PENDING', request: { dueAt: { lt: now } } },
      data: { status: 'OVERDUE' },
    });
  }

  requestMember(fundId: string, requestMemberId: string) {
    return this.db.fundContributionRequestMember.findFirst({
      where: { id: requestMemberId, request: { fundId } },
      select: {
        id: true,
        amountCents: true,
        status: true,
        fundMemberId: true,
        request: { select: { id: true, dueAt: true } },
        fundMember: { select: { groupMemberId: true, groupMember: { select: { userId: true } } } },
      },
    });
  }

  openRequestMemberForUser(fundId: string, userId: string, amountCents: number) {
    return this.db.fundContributionRequestMember.findFirst({
      where: {
        amountCents,
        status: { in: ['PENDING', 'OVERDUE'] },
        request: { fundId },
        fundMember: { groupMember: { userId } },
      },
      orderBy: [{ request: { dueAt: 'asc' } }, { id: 'asc' }],
      select: { id: true, amountCents: true, status: true },
    });
  }

  contributionMembersDueBetween(now: Date, until: Date) {
    return this.db.fundContributionRequestMember.findMany({
      where: { status: 'PENDING', request: { dueAt: { gt: now, lte: until } } },
      select: {
        id: true,
        amountCents: true,
        request: {
          select: {
            id: true,
            dueAt: true,
            fund: { select: { id: true, groupId: true, name: true, currency: true } },
          },
        },
        fundMember: { select: { groupMember: { select: { userId: true } } } },
      },
      orderBy: [{ request: { dueAt: 'asc' } }, { id: 'asc' }],
      take: 1000,
    });
  }

  contributionMembersOverdue(now: Date) {
    return this.db.fundContributionRequestMember.findMany({
      where: { status: 'OVERDUE', request: { dueAt: { lt: now } } },
      select: {
        id: true,
        amountCents: true,
        request: {
          select: {
            id: true,
            dueAt: true,
            fund: { select: { id: true, groupId: true, name: true, currency: true } },
          },
        },
        fundMember: { select: { groupMember: { select: { userId: true } } } },
      },
      orderBy: [{ request: { dueAt: 'asc' } }, { id: 'asc' }],
      take: 1000,
    });
  }

  update(fundId: string, data: Prisma.FundUpdateInput) {
    return this.db.fund.update({ where: { id: fundId }, data, select: fundView });
  }

  /** Archiva bajo el mismo bloqueo que serializa los movimientos del fondo. */
  archiveAtomic(fundId: string) {
    return withSerializableRetry(() =>
      this.db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>(
            Prisma.sql`SELECT "archivedAt" FROM "Fund" WHERE "id" = ${fundId}::uuid FOR UPDATE`,
          );
          if (!locked[0]) return { outcome: 'NOT_FOUND' as const };
          if (locked[0].archivedAt) return { outcome: 'ALREADY_ARCHIVED' as const };
          const balance =
            (
              await tx.fundMovement.aggregate({
                where: { fundId },
                _sum: { amountCents: true },
              })
            )._sum.amountCents ?? 0;
          if (balance !== 0) return { outcome: 'NON_ZERO' as const };
          const fund = await tx.fund.update({
            where: { id: fundId },
            data: { archivedAt: new Date() },
            select: fundView,
          });
          return { outcome: 'ARCHIVED' as const, fund };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  countManagers(fundId: string) {
    return this.db.fundMember.count({ where: { fundId, role: FundRole.MANAGER } });
  }

  addMember(fundId: string, groupMemberId: string, role: FundRole) {
    return this.db.fundMember.create({
      data: { fundId, groupMemberId, role },
      select: { id: true, role: true, groupMemberId: true },
    });
  }

  /** Cambia el rol bajo el bloqueo del fondo para no dejarlo sin gestores concurrentemente. */
  updateMemberAtomic(fundId: string, memberId: string, role: FundRole) {
    return withSerializableRetry(() =>
      this.db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "Fund" WHERE "id" = ${fundId}::uuid FOR UPDATE`,
          );
          if (!locked[0]) return { outcome: 'NOT_FOUND' as const };
          const member = await tx.fundMember.findFirst({
            where: { id: memberId, fundId },
            select: { id: true, role: true, groupMemberId: true },
          });
          if (!member) return { outcome: 'NOT_FOUND' as const };
          if (member.role === FundRole.MANAGER && role !== FundRole.MANAGER) {
            const managers = await tx.fundMember.count({
              where: { fundId, role: FundRole.MANAGER },
            });
            if (managers <= 1) return { outcome: 'LAST_MANAGER' as const };
          }
          await tx.fundMember.update({ where: { id: memberId }, data: { role } });
          return { outcome: 'UPDATED' as const, member: { ...member, role } };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  findMember(fundId: string, memberId: string) {
    return this.db.fundMember.findFirst({
      where: { id: memberId, fundId },
      select: { id: true, role: true, groupMemberId: true },
    });
  }

  /** Elimina un miembro bajo el mismo bloqueo y conserva al menos un gestor. */
  removeMemberAtomic(fundId: string, memberId: string) {
    return withSerializableRetry(() =>
      this.db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "Fund" WHERE "id" = ${fundId}::uuid FOR UPDATE`,
          );
          if (!locked[0]) return { outcome: 'NOT_FOUND' as const };
          const member = await tx.fundMember.findFirst({
            where: { id: memberId, fundId },
            select: { role: true },
          });
          if (!member) return { outcome: 'NOT_FOUND' as const };
          if (member.role === FundRole.MANAGER) {
            const managers = await tx.fundMember.count({
              where: { fundId, role: FundRole.MANAGER },
            });
            if (managers <= 1) return { outcome: 'LAST_MANAGER' as const };
          }
          await tx.fundMember.delete({ where: { id: memberId } });
          return { outcome: 'REMOVED' as const };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  movements(fundId: string, cursor: string | undefined, limit: number) {
    return this.db.fundMovement.findMany({
      where: { fundId },
      select: movementView,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  findIdempotency(userId: string, scope: string, key: string) {
    return this.db.idempotencyKey.findFirst({
      where: { userId, scope, key, expiresAt: { gt: new Date() } },
      select: { requestHash: true, responseBody: true },
    });
  }

  /**
   * Inserta un movimiento con bloqueo del fondo: el saldo derivado nunca queda negativo
   * aunque dos retiros lleguen a la vez. Idempotente por usuario, fondo y llave.
   */
  async createMovementAtomic(input: {
    fundId: string;
    userId: string;
    type: FundMovementType;
    signedAmountCents: number;
    description?: string | undefined;
    key: string;
    requestHash: string;
    requestId: string;
    contributionRequestMemberId?: string;
  }) {
    const scope = `fund:movement:${input.fundId}`;
    try {
      return await withSerializableRetry(() =>
        this.db.$transaction(
          async (tx) => {
            const replay = await tx.idempotencyKey.findUnique({
              where: { userId_scope_key: { userId: input.userId, scope, key: input.key } },
            });
            if (replay && isIdempotencyActive(replay.expiresAt, new Date())) {
              return {
                outcome: 'REPLAY' as const,
                data: replay.responseBody,
                requestHash: replay.requestHash,
              };
            }
            if (replay) await tx.idempotencyKey.delete({ where: { id: replay.id } });
            const locked = await tx.$queryRaw<Array<{ archivedAt: Date | null }>>(
              Prisma.sql`SELECT "archivedAt" FROM "Fund" WHERE "id" = ${input.fundId}::uuid FOR UPDATE`,
            );
            if (!locked[0]) return { outcome: 'NOT_FOUND' as const };
            if (locked[0].archivedAt) return { outcome: 'ARCHIVED' as const };
            const sum = await tx.fundMovement.aggregate({
              where: { fundId: input.fundId },
              _sum: { amountCents: true },
            });
            const balance = sum._sum.amountCents ?? 0;
            const next = balance + input.signedAmountCents;
            if (next < 0) return { outcome: 'INSUFFICIENT' as const, balance };
            if (!Number.isSafeInteger(next) || next > 2_147_483_647)
              return { outcome: 'OVERFLOW' as const };
            const movement = await tx.fundMovement.create({
              data: {
                fundId: input.fundId,
                type: input.type,
                amountCents: input.signedAmountCents,
                createdById: input.userId,
                ...(input.description ? { description: input.description } : {}),
                ...(input.contributionRequestMemberId
                  ? { contributionRequestMemberId: input.contributionRequestMemberId }
                  : {}),
              },
              select: movementView,
            });
            if (input.contributionRequestMemberId) {
              await tx.fundContributionRequestMember.updateMany({
                where: {
                  id: input.contributionRequestMemberId,
                  status: { in: ['PENDING', 'OVERDUE'] },
                  request: { fundId: input.fundId },
                },
                data: { status: 'PAID', paidAt: new Date() },
              });
            }
            const data = { movement, balanceCents: next };
            await tx.idempotencyKey.create({
              data: {
                userId: input.userId,
                scope,
                key: input.key,
                requestHash: input.requestHash,
                responseStatus: 201,
                responseBody: JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue,
                resourceId: movement.id,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });
            await tx.auditLog.create({
              data: {
                userId: input.userId,
                action: 'fund.movement_created',
                entityType: 'FundMovement',
                entityId: movement.id,
                requestId: input.requestId,
                metadata: {
                  fundId: input.fundId,
                  type: input.type,
                  amountCents: input.signedAmountCents,
                },
              },
            });
            return { outcome: 'CREATED' as const, data, requestHash: input.requestHash };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findIdempotency(input.userId, scope, input.key);
        if (replay)
          return {
            outcome: 'REPLAY' as const,
            data: replay.responseBody,
            requestHash: replay.requestHash,
          };
      }
      throw error;
    }
  }

  managersOf(fundId: string) {
    return this.db.fundMember.findMany({
      where: { fundId, role: FundRole.MANAGER },
      select: { groupMember: { select: { userId: true } } },
    });
  }
}
