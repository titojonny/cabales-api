import type { Prisma } from '@prisma/client';
import { EventStatus, TransferStatus } from '@prisma/client';
import { z } from 'zod';
import type { Database } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';

export const cabudasSummaryQuerySchema = z
  .object({
    groupId: z.string().uuid().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

export const cabudasHistoryQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'PAID', 'DISPUTED', 'CANCELLED', 'ALL']).default('ALL'),
    direction: z.enum(['PAY', 'RECEIVE', 'ALL']).default('ALL'),
    groupId: z.string().uuid().optional(),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export type CabudasSummaryQuery = z.infer<typeof cabudasSummaryQuerySchema>;
export type CabudasHistoryQuery = z.infer<typeof cabudasHistoryQuerySchema>;

const participantSelect = {
  groupMemberId: true,
  guestName: true,
  groupMember: { select: { user: { select: { id: true, displayName: true } } } },
} as const;

const transferSelect = {
  id: true,
  amountCents: true,
  status: true,
  paidAt: true,
  createdAt: true,
  settlement: {
    select: {
      id: true,
      groupId: true,
      currency: true,
      event: { select: { id: true, name: true } },
      group: { select: { name: true } },
    },
  },
  debtor: { select: participantSelect },
  creditor: { select: participantSelect },
} as const;

type TransferRow = Prisma.SettlementTransferGetPayload<{ select: typeof transferSelect }>;
type Party = TransferRow['debtor'];

function counterparty(party: Party) {
  const user = party.groupMember?.user;
  return user
    ? { userId: user.id, displayName: user.displayName, isGuest: false }
    : { userId: null, displayName: party.guestName ?? 'Invitado', isGuest: true };
}

type Totals = { owedToMeCents: number; iOweCents: number };

/**
 * Cabudas: vista consolidada de deudas del usuario entre todos sus grupos.
 * Confirmadas = transferencias PENDING de liquidaciones; estimadas = eventos abiertos sin liquidar.
 */
export class CabudasService {
  constructor(private readonly db: Database) {}

  private async memberships(userId: string, groupId?: string) {
    const memberships = await this.db.groupMember.findMany({
      where: { userId, ...(groupId ? { groupId } : {}) },
      select: { id: true, groupId: true, group: { select: { name: true, currency: true } } },
    });
    if (groupId && memberships.length === 0)
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    return memberships;
  }

  private direction(row: TransferRow, memberIds: Set<string>): 'PAY' | 'RECEIVE' {
    return row.debtor.groupMemberId && memberIds.has(row.debtor.groupMemberId) ? 'PAY' : 'RECEIVE';
  }

  private presentTransfer(row: TransferRow, memberIds: Set<string>) {
    const direction = this.direction(row, memberIds);
    return {
      transferId: row.id,
      settlementId: row.settlement.id,
      groupId: row.settlement.groupId,
      groupName: row.settlement.group.name,
      eventId: row.settlement.event.id,
      eventName: row.settlement.event.name,
      direction,
      counterparty: counterparty(direction === 'PAY' ? row.creditor : row.debtor),
      amountCents: row.amountCents,
      currency: row.settlement.currency,
      status: row.status,
      paidAt: row.paidAt,
      createdAt: row.createdAt,
    };
  }

  async summary(userId: string, query: CabudasSummaryQuery) {
    const memberships = await this.memberships(userId, query.groupId);
    const memberIds = memberships.map((membership) => membership.id);
    const memberSet = new Set(memberIds);
    const rows = await this.db.settlementTransfer.findMany({
      where: {
        status: TransferStatus.PENDING,
        ...(query.currency ? { settlement: { currency: query.currency } } : {}),
        OR: [
          { debtor: { groupMemberId: { in: memberIds } } },
          { creditor: { groupMemberId: { in: memberIds } } },
        ],
      },
      select: transferSelect,
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });
    const pending = rows.map((row) => this.presentTransfer(row, memberSet));

    const totals = new Map<string, Totals>();
    const groups = new Map<
      string,
      Totals & { groupId: string; groupName: string; currency: string }
    >();
    const people = new Map<
      string,
      {
        counterparty: ReturnType<typeof counterparty>;
        groupId: string | null;
        currency: string;
        netCents: number;
      }
    >();
    for (const transfer of pending) {
      const sign = transfer.direction === 'RECEIVE' ? 1 : -1;
      const total = totals.get(transfer.currency) ?? { owedToMeCents: 0, iOweCents: 0 };
      const groupKey = `${transfer.groupId}:${transfer.currency}`;
      const group = groups.get(groupKey) ?? {
        groupId: transfer.groupId,
        groupName: transfer.groupName,
        currency: transfer.currency,
        owedToMeCents: 0,
        iOweCents: 0,
      };
      if (sign > 0) {
        total.owedToMeCents += transfer.amountCents;
        group.owedToMeCents += transfer.amountCents;
      } else {
        total.iOweCents += transfer.amountCents;
        group.iOweCents += transfer.amountCents;
      }
      totals.set(transfer.currency, total);
      groups.set(groupKey, group);
      // Personas registradas se consolidan entre grupos; invitados solo dentro de su grupo.
      const personKey = transfer.counterparty.userId
        ? `u:${transfer.counterparty.userId}:${transfer.currency}`
        : `g:${transfer.groupId}:${transfer.counterparty.displayName}:${transfer.currency}`;
      const person = people.get(personKey) ?? {
        counterparty: transfer.counterparty,
        groupId: transfer.counterparty.userId ? null : transfer.groupId,
        currency: transfer.currency,
        netCents: 0,
      };
      person.netCents += sign * transfer.amountCents;
      people.set(personKey, person);
    }

    const openEvents = await this.openEventEstimates(memberships, query.currency);
    const peopleList = [...people.values()].filter((person) => person.netCents !== 0);
    return {
      totals: [...totals.entries()].map(([currency, value]) => ({
        currency,
        ...value,
        netCents: value.owedToMeCents - value.iOweCents,
      })),
      groups: [...groups.values()].map((group) => ({
        ...group,
        netCents: group.owedToMeCents - group.iOweCents,
      })),
      people: peopleList.sort((a, b) => Math.abs(b.netCents) - Math.abs(a.netCents)),
      simplifiedTransfers: peopleList.map((person) => ({
        direction: person.netCents > 0 ? ('RECEIVE' as const) : ('PAY' as const),
        counterparty: person.counterparty,
        groupId: person.groupId,
        currency: person.currency,
        amountCents: Math.abs(person.netCents),
      })),
      pendingTransfers: pending,
      openEvents,
    };
  }

  /** Estimación de saldo propio en eventos abiertos: parte consumida menos lo pagado. */
  private async openEventEstimates(
    memberships: Array<{ id: string; groupId: string; group: { name: string; currency: string } }>,
    currency?: string,
  ) {
    const memberIds = memberships.map((membership) => membership.id);
    const events = await this.db.event.findMany({
      where: {
        status: EventStatus.OPEN,
        settlement: null,
        participants: { some: { groupMemberId: { in: memberIds } } },
      },
      select: {
        id: true,
        name: true,
        groupId: true,
        group: { select: { name: true } },
        participants: { where: { groupMemberId: { in: memberIds } }, select: { id: true } },
        expenses: {
          where: currency ? { currency } : {},
          select: {
            currency: true,
            participants: {
              select: {
                eventParticipantId: true,
                shareCents: true,
                payer: { select: { amountCents: true } },
              },
            },
          },
        },
      },
      orderBy: { startsAt: 'desc' },
      take: 50,
    });
    const result = [];
    for (const event of events) {
      const mine = new Set(event.participants.map((participant) => participant.id));
      const byCurrency = new Map<string, number>();
      for (const expense of event.expenses) {
        for (const participant of expense.participants) {
          if (!mine.has(participant.eventParticipantId)) continue;
          const net = participant.shareCents - (participant.payer?.amountCents ?? 0);
          byCurrency.set(expense.currency, (byCurrency.get(expense.currency) ?? 0) + net);
        }
      }
      for (const [eventCurrency, netCents] of byCurrency) {
        if (netCents === 0) continue;
        result.push({
          eventId: event.id,
          eventName: event.name,
          groupId: event.groupId,
          groupName: event.group.name,
          currency: eventCurrency,
          // Positivo: te toca pagar al liquidar; negativo: te deben.
          myNetCents: netCents,
        });
      }
    }
    return result;
  }

  async history(userId: string, query: CabudasHistoryQuery) {
    const memberships = await this.memberships(userId, query.groupId);
    const memberIds = memberships.map((membership) => membership.id);
    const memberSet = new Set(memberIds);
    const side =
      query.direction === 'PAY'
        ? [{ debtor: { groupMemberId: { in: memberIds } } }]
        : query.direction === 'RECEIVE'
          ? [{ creditor: { groupMemberId: { in: memberIds } } }]
          : [
              { debtor: { groupMemberId: { in: memberIds } } },
              { creditor: { groupMemberId: { in: memberIds } } },
            ];
    const rows = await this.db.settlementTransfer.findMany({
      where: { ...(query.status !== 'ALL' ? { status: query.status } : {}), OR: side },
      select: transferSelect,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, query.limit).map((row) => this.presentTransfer(row, memberSet));
    return {
      items,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.transferId ?? null) : null,
    };
  }
}
