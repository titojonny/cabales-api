import { EventStatus, Prisma, SettlementStatus, TransferStatus } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { withSerializableRetry } from '../../database/transaction.js';
import { isIdempotencyActive } from '../../shared/idempotency.js';
import type { SettlementTransferPlan } from '../../shared/settlement.js';

const settlementDetail = {
  id: true,
  groupId: true,
  eventId: true,
  status: true,
  currency: true,
  createdAt: true,
  completedAt: true,
  transfers: {
    select: {
      id: true,
      debtorParticipantId: true,
      creditorParticipantId: true,
      amountCents: true,
      status: true,
      paidAt: true,
      debtor: { select: { guestName: true, groupMemberId: true } },
      creditor: { select: { guestName: true, groupMemberId: true } },
      history: {
        select: { fromStatus: true, toStatus: true, createdAt: true },
        orderBy: { createdAt: 'asc' as const },
      },
    },
    orderBy: { createdAt: 'asc' as const },
  },
} as const;

/** Persistencia serializable de cierres y estados de transferencias. */
export class SettlementsRepository {
  constructor(private readonly db: Database) {}

  context(groupId: string, eventId: string) {
    return this.db.event.findFirst({
      where: { id: eventId, groupId },
      select: {
        id: true,
        status: true,
        settlement: { select: { id: true } },
        expenses: {
          select: {
            id: true,
            currency: true,
            totalCents: true,
            participants: { select: { eventParticipantId: true, shareCents: true } },
            payers: {
              select: {
                amountCents: true,
                expenseParticipant: { select: { eventParticipantId: true } },
              },
            },
          },
          orderBy: { id: 'asc' },
        },
      },
    });
  }

  findIdempotency(userId: string, scope: string, key: string) {
    return this.db.idempotencyKey.findFirst({
      where: { userId, scope, key, expiresAt: { gt: new Date() } },
      select: { requestHash: true, responseBody: true },
    });
  }

  /** Cierra el evento y reclama una llave reutilizable tras su expiración. */
  async createAtomic(input: {
    groupId: string;
    eventId: string;
    userId: string;
    requestId: string;
    key: string;
    requestHash: string;
    currency: string;
    expenseIds: string[];
    transfers: SettlementTransferPlan[];
  }) {
    const scope = `settlement:create:${input.groupId}`;
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
            const event = await tx.event.findFirst({
              where: { id: input.eventId, groupId: input.groupId },
              select: {
                status: true,
                settlement: { select: { id: true } },
                expenses: { select: { id: true }, orderBy: { id: 'asc' } },
              },
            });
            if (!event || event.status !== EventStatus.OPEN || event.settlement) {
              throw new Error('SETTLEMENT_EXISTS');
            }
            if (
              event.expenses.map((expense) => expense.id).join(',') !== input.expenseIds.join(',')
            ) {
              throw new Error('EVENT_CHANGED');
            }
            const completed = input.transfers.length === 0;
            const settlement = await tx.settlement.create({
              data: {
                groupId: input.groupId,
                eventId: input.eventId,
                createdById: input.userId,
                currency: input.currency,
                status: completed ? SettlementStatus.COMPLETED : SettlementStatus.OPEN,
                completedAt: completed ? new Date() : null,
                transfers: {
                  create: input.transfers.map((transfer) => ({
                    ...transfer,
                    history: {
                      create: { toStatus: TransferStatus.PENDING, changedById: input.userId },
                    },
                  })),
                },
              },
            });
            await tx.event.update({
              where: { id: input.eventId },
              data: { status: EventStatus.CLOSED },
            });
            const data = await tx.settlement.findUniqueOrThrow({
              where: { id: settlement.id },
              select: settlementDetail,
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
                resourceId: settlement.id,
                expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
              },
            });
            await tx.auditLog.create({
              data: {
                userId: input.userId,
                action: 'settlement.created',
                entityType: 'Settlement',
                entityId: settlement.id,
                requestId: input.requestId,
                metadata: {
                  groupId: input.groupId,
                  eventId: input.eventId,
                  transferCount: input.transfers.length,
                },
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
        if (replay) {
          return { data: replay.responseBody, replayed: true, requestHash: replay.requestHash };
        }
        const existing = await this.db.settlement.findUnique({
          where: { eventId: input.eventId },
          select: { id: true },
        });
        if (existing) throw new Error('SETTLEMENT_EXISTS', { cause: error });
      }
      throw error;
    }
  }

  list(groupId: string) {
    return this.db.settlement.findMany({
      where: { groupId },
      select: {
        id: true,
        eventId: true,
        status: true,
        currency: true,
        createdAt: true,
        completedAt: true,
        _count: { select: { transfers: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  detail(groupId: string, settlementId: string) {
    return this.db.settlement.findFirst({
      where: { id: settlementId, groupId },
      select: settlementDetail,
    });
  }

  transferContext(groupId: string, settlementId: string, transferId: string) {
    return this.db.settlementTransfer.findFirst({
      where: { id: transferId, settlementId, settlement: { groupId } },
      select: {
        id: true,
        status: true,
        settlement: { select: { status: true } },
        debtor: { select: { groupMember: { select: { userId: true } } } },
      },
    });
  }

  /** Marca una transferencia una sola vez y converge el cierre aunque la petición sea repetida. */
  async markPaid(input: {
    groupId: string;
    settlementId: string;
    transferId: string;
    userId: string;
    requestId: string;
  }) {
    const transfer = await withSerializableRetry(() =>
      this.db.$transaction(
        async (tx) => {
          const current = await tx.settlementTransfer.findFirst({
            where: {
              id: input.transferId,
              settlementId: input.settlementId,
              settlement: { groupId: input.groupId },
            },
            select: { id: true, status: true, amountCents: true, paidAt: true },
          });
          if (!current || current.status !== TransferStatus.PENDING) return current;

          // Esta escritura serializa pagos de una misma liquidación; el perdedor reintenta P2034.
          const lockedSettlement = await tx.settlement.updateMany({
            where: {
              id: input.settlementId,
              groupId: input.groupId,
              status: SettlementStatus.OPEN,
            },
            data: { updatedAt: new Date() },
          });
          if (lockedSettlement.count !== 1) return current;

          const changed = await tx.settlementTransfer.updateMany({
            where: {
              id: input.transferId,
              status: TransferStatus.PENDING,
              settlement: { status: SettlementStatus.OPEN },
            },
            data: {
              status: TransferStatus.PAID,
              paidAt: new Date(),
              markedPaidById: input.userId,
            },
          });
          if (changed.count !== 1) {
            return tx.settlementTransfer.findUnique({
              where: { id: input.transferId },
              select: { id: true, status: true, amountCents: true, paidAt: true },
            });
          }
          await tx.transferStatusHistory.create({
            data: {
              transferId: input.transferId,
              fromStatus: TransferStatus.PENDING,
              toStatus: TransferStatus.PAID,
              changedById: input.userId,
            },
          });
          await tx.auditLog.create({
            data: {
              userId: input.userId,
              action: 'settlement_transfer.paid',
              entityType: 'SettlementTransfer',
              entityId: input.transferId,
              requestId: input.requestId,
            },
          });
          await this.completeIfNoPending(tx, input.groupId, input.settlementId);
          return tx.settlementTransfer.findUnique({
            where: { id: input.transferId },
            select: { id: true, status: true, amountCents: true, paidAt: true },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );

    // La comprobación posterior converge cuando dos últimas transferencias se pagaron en paralelo.
    if (transfer?.status === TransferStatus.PAID) {
      await this.db.settlement.updateMany({
        where: {
          id: input.settlementId,
          groupId: input.groupId,
          status: SettlementStatus.OPEN,
          transfers: { none: { status: TransferStatus.PENDING } },
        },
        data: { status: SettlementStatus.COMPLETED, completedAt: new Date() },
      });
    }
    return transfer;
  }

  private completeIfNoPending(tx: Prisma.TransactionClient, groupId: string, settlementId: string) {
    return tx.settlement.updateMany({
      where: {
        id: settlementId,
        groupId,
        status: SettlementStatus.OPEN,
        transfers: { none: { status: TransferStatus.PENDING } },
      },
      data: { status: SettlementStatus.COMPLETED, completedAt: new Date() },
    });
  }
}
