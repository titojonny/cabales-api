import { describe, expect, it } from 'vitest';
import { EventStatus, GroupRole } from '@prisma/client';
import type { ExpensesRepository } from '../src/modules/expenses/expenses.repository.js';
import { ExpensesService } from '../src/modules/expenses/expenses.service.js';
import type { GroupsService } from '../src/modules/groups/groups.service.js';
import {
  splitByBasisPoints,
  splitProportionally,
  roundBasisPointCharge,
} from '../src/shared/expense-splitting.js';

const p1 = '20000000-0000-4000-8000-000000000002';
const p2 = '20000000-0000-4000-8000-000000000003';
const eventId = '10000000-0000-4000-8000-000000000001';

describe('dominio de reparto PERCENT', () => {
  it('conserva el subtotal con uno y doscientos participantes', () => {
    expect(splitByBasisPoints(1, [10_000])).toEqual([1]);
    const result = splitByBasisPoints(
      10_000,
      Array.from({ length: 200 }, () => 50),
    );
    expect(result).toHaveLength(200);
    expect(result.every((value) => value === 50)).toBe(true);
    expect(result.reduce((sum, value) => sum + value, 0)).toBe(10_000);
  });

  it('exige exactamente 10000 puntos básicos y usa restos mayores', () => {
    expect(() => splitByBasisPoints(100, [5000, 4999])).toThrowError(
      expect.objectContaining({ code: 'PERCENTAGES_MISMATCH' }),
    );
    expect(splitByBasisPoints(100, [3333, 3333, 3334])).toEqual([33, 33, 34]);
  });

  it('redondea cargos y los reparte proporcionalmente sin perder centavos', () => {
    expect(roundBasisPointCharge(101, 500)).toBe(5);
    expect(splitProportionally(5, [1, 2])).toEqual([2, 3]);
    expect(splitProportionally(7, [1, 1, 1])).toEqual([3, 2, 2]);
  });
});

function groups() {
  return {
    requireRole: async () => ({
      id: 'member',
      groupId: 'group',
      userId: 'user',
      role: GroupRole.MEMBER,
    }),
  } as unknown as GroupsService;
}

function context() {
  return {
    id: eventId,
    status: EventStatus.OPEN,
    settlement: null,
    group: { currency: 'USD' },
    participants: [
      { id: p1, groupMemberId: 'member-1' },
      { id: p2, groupMemberId: 'member-2' },
    ],
  };
}

describe('ExpensesService PERCENT', () => {
  it('calcula impuesto y propina proporcionales y conserva el total', async () => {
    let prepared: unknown;
    const repository = {
      findIdempotency: async () => null,
      context: async () => context(),
      createAtomic: async (input: { expense: unknown; requestHash: string }) => {
        prepared = input.expense;
        return { data: { id: 'expense' }, replayed: false, requestHash: input.requestHash };
      },
    } as unknown as ExpensesRepository;
    const service = new ExpensesService(repository, groups());

    await service.create('user', 'group', 'percent-key', 'request', {
      eventId,
      title: 'Cena',
      totalCents: 12_500,
      subtotalCents: 10_000,
      taxPercentBps: 1_000,
      tipPercentBps: 1_500,
      currency: 'USD',
      splitMode: 'PERCENT',
      occurredAt: new Date('2026-08-21T12:00:00.000Z'),
      participants: [
        { eventParticipantId: p1, percentageBps: 3333 },
        { eventParticipantId: p2, percentageBps: 6667 },
      ],
      payers: [{ eventParticipantId: p1, amountCents: 12_500 }],
    });

    expect(prepared).toMatchObject({ subtotalCents: 10_000, taxCents: 1_000, tipCents: 1_500 });
    expect(
      (
        prepared as {
          participants: Array<{
            eventParticipantId: string;
            subtotalCents: number;
            taxCents: number;
            tipCents: number;
            shareCents: number;
          }>;
        }
      ).participants,
    ).toEqual([
      {
        eventParticipantId: p1,
        subtotalCents: 3333,
        taxCents: 333,
        tipCents: 500,
        shareCents: 4166,
      },
      {
        eventParticipantId: p2,
        subtotalCents: 6667,
        taxCents: 667,
        tipCents: 1000,
        shareCents: 8334,
      },
    ]);
  });

  it('rechaza porcentajes que no suman 10000 en el servicio', async () => {
    const repository = {
      findIdempotency: async () => null,
      context: async () => context(),
      createAtomic: async () => ({ data: { id: 'unused' }, replayed: false, requestHash: 'hash' }),
    } as unknown as ExpensesRepository;
    const service = new ExpensesService(repository, groups());
    await expect(
      service.create('user', 'group', 'invalid-percent-key', 'request', {
        eventId,
        title: 'Cena',
        totalCents: 10_000,
        subtotalCents: 10_000,
        currency: 'USD',
        splitMode: 'PERCENT',
        occurredAt: new Date('2026-08-21T12:00:00.000Z'),
        participants: [
          { eventParticipantId: p1, percentageBps: 5000 },
          { eventParticipantId: p2, percentageBps: 4999 },
        ],
        payers: [{ eventParticipantId: p1, amountCents: 10_000 }],
      }),
    ).rejects.toMatchObject({ code: 'PERCENTAGES_MISMATCH' });
  });
});
