import { EventStatus, Prisma, type SplitMode } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { withSerializableRetry } from '../../database/transaction.js';
import { isIdempotencyActive } from '../../shared/idempotency.js';

/** Gasto con invariantes ya comprobadas y listo para persistencia atómica. */
export interface PreparedExpense {
  eventId: string;
  title: string;
  notes?: string;
  totalCents: number;
  currency: string;
  splitMode: SplitMode;
  occurredAt: Date;
  participants: Array<{ eventParticipantId: string; shareCents: number }>;
  payers: Array<{ eventParticipantId: string; amountCents: number }>;
  items: Array<{
    name: string;
    amountCents: number;
    quantity: number;
    allocations: Array<{ eventParticipantId: string; amountCents: number }>;
  }>;
}

const expenseDetail = {
  id: true,
  groupId: true,
  eventId: true,
  title: true,
  notes: true,
  totalCents: true,
  currency: true,
  splitMode: true,
  occurredAt: true,
  createdAt: true,
  participants: {
    select: {
      id: true,
      eventParticipantId: true,
      shareCents: true,
      eventParticipant: { select: { guestName: true, groupMemberId: true } },
    },
  },
  payers: {
    select: {
      id: true,
      amountCents: true,
      expenseParticipant: { select: { eventParticipantId: true } },
    },
  },
  items: {
    select: {
      id: true,
      name: true,
      amountCents: true,
      quantity: true,
      allocations: {
        select: {
          amountCents: true,
          expenseParticipant: { select: { eventParticipantId: true } },
        },
      },
    },
  },
} as const;

/** Persistencia transaccional de gastos e idempotencia. */
export class ExpensesRepository {
  constructor(private readonly db: Database) {}

  context(groupId: string, eventId: string) {
    return this.db.event.findFirst({
      where: { id: eventId, groupId },
      select: {
        id: true,
        status: true,
        settlement: { select: { id: true } },
        group: { select: { currency: true } },
        participants: { select: { id: true, groupMemberId: true } },
      },
    });
  }

  list(groupId: string) {
    return this.db.expense.findMany({
      where: { groupId },
      select: {
        id: true,
        eventId: true,
        title: true,
        totalCents: true,
        currency: true,
        splitMode: true,
        occurredAt: true,
        createdAt: true,
        _count: { select: { participants: true, items: true } },
      },
      orderBy: [{ occurredAt: 'desc' }, { id: 'asc' }],
    });
  }

  detail(groupId: string, expenseId: string) {
    return this.db.expense.findFirst({ where: { id: expenseId, groupId }, select: expenseDetail });
  }

  findIdempotency(userId: string, scope: string, key: string) {
    return this.db.idempotencyKey.findFirst({
      where: { userId, scope, key, expiresAt: { gt: new Date() } },
      select: { requestHash: true, responseBody: true, responseStatus: true },
    });
  }

  /** Reclama idempotencia, valida contexto bloqueado y persiste el gasto como una unidad. */
  async createAtomic(input: {
    groupId: string;
    userId: string;
    requestId: string;
    key: string;
    requestHash: string;
    expense: PreparedExpense;
  }) {
    const scope = `expense:create:${input.groupId}`;
    try {
      return await withSerializableRetry(() =>
        this.db.$transaction(
          async (tx) => {
            const now = new Date();
            const replay = await tx.idempotencyKey.findUnique({
              where: { userId_scope_key: { userId: input.userId, scope, key: input.key } },
            });
            if (replay && isIdempotencyActive(replay.expiresAt, now)) {
              return { data: replay.responseBody, replayed: true, requestHash: replay.requestHash };
            }
            if (replay) await tx.idempotencyKey.delete({ where: { id: replay.id } });

            // FOR SHARE serializa el gasto con cambios de moneda y borrado del grupo.
            const lockedGroups = await tx.$queryRaw<Array<{ currency: string }>>(
              Prisma.sql`SELECT "currency" FROM "Group" WHERE "id" = ${input.groupId}::uuid FOR SHARE`,
            );
            if (lockedGroups[0]?.currency !== input.expense.currency) {
              throw new Error('CURRENCY_MISMATCH');
            }

            const event = await tx.event.findFirst({
              where: { id: input.expense.eventId, groupId: input.groupId },
              select: { status: true, settlement: { select: { id: true } } },
            });
            if (!event || event.status !== EventStatus.OPEN || event.settlement) {
              throw new Error('EVENT_LOCKED');
            }

            const participantIds = input.expense.participants.map(
              (participant) => participant.eventParticipantId,
            );
            const eventParticipants = await tx.eventParticipant.findMany({
              where: { eventId: input.expense.eventId, id: { in: participantIds } },
              select: { id: true, groupMemberId: true },
            });
            if (eventParticipants.length !== participantIds.length) {
              throw new Error('PARTICIPANT_OUTSIDE_EVENT');
            }
            const groupMembers = new Map(
              eventParticipants.map((participant) => [participant.id, participant.groupMemberId]),
            );

            const expense = await tx.expense.create({
              data: {
                groupId: input.groupId,
                eventId: input.expense.eventId,
                createdById: input.userId,
                title: input.expense.title,
                ...(input.expense.notes ? { notes: input.expense.notes } : {}),
                totalCents: input.expense.totalCents,
                currency: input.expense.currency,
                splitMode: input.expense.splitMode,
                occurredAt: input.expense.occurredAt,
              },
            });
            await tx.expenseParticipant.createMany({
              data: input.expense.participants.map((participant) => ({
                expenseId: expense.id,
                ...participant,
                groupMemberId: groupMembers.get(participant.eventParticipantId) ?? null,
              })),
            });
            const storedParticipants = await tx.expenseParticipant.findMany({
              where: { expenseId: expense.id },
              select: { id: true, eventParticipantId: true },
            });
            const ids = new Map(
              storedParticipants.map((participant) => [
                participant.eventParticipantId,
                participant.id,
              ]),
            );
            await tx.expensePayer.createMany({
              data: input.expense.payers.map((payer) => ({
                expenseId: expense.id,
                expenseParticipantId: ids.get(payer.eventParticipantId)!,
                amountCents: payer.amountCents,
              })),
            });
            for (const item of input.expense.items) {
              const storedItem = await tx.expenseItem.create({
                data: {
                  expenseId: expense.id,
                  name: item.name,
                  amountCents: item.amountCents,
                  quantity: item.quantity,
                },
              });
              await tx.expenseItemAllocation.createMany({
                data: item.allocations.map((allocation) => ({
                  expenseItemId: storedItem.id,
                  expenseParticipantId: ids.get(allocation.eventParticipantId)!,
                  amountCents: allocation.amountCents,
                })),
              });
            }
            const data = await tx.expense.findUniqueOrThrow({
              where: { id: expense.id },
              select: expenseDetail,
            });
            const json = JSON.parse(JSON.stringify(data)) as Prisma.InputJsonValue;
            await tx.idempotencyKey.create({
              data: {
                userId: input.userId,
                scope,
                key: input.key,
                requestHash: input.requestHash,
                responseStatus: 201,
                responseBody: json,
                resourceId: expense.id,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });
            await tx.auditLog.create({
              data: {
                userId: input.userId,
                action: 'expense.created',
                entityType: 'Expense',
                entityId: expense.id,
                requestId: input.requestId,
                metadata: { groupId: input.groupId, totalCents: input.expense.totalCents },
              },
            });
            return { data, replayed: false, requestHash: input.requestHash };
          },
          { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
        ),
      );
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const replay = await this.findIdempotency(input.userId, scope, input.key);
        if (replay)
          return { data: replay.responseBody, replayed: true, requestHash: replay.requestHash };
      }
      throw error;
    }
  }
}
