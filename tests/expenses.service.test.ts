import { EventStatus, GroupRole, SplitMode } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import type { ExpensesRepository } from '../src/modules/expenses/expenses.repository.js';
import { ExpensesService } from '../src/modules/expenses/expenses.service.js';
import type { GroupsService } from '../src/modules/groups/groups.service.js';
import { requestHash } from '../src/shared/crypto.js';

const eventId = '10000000-0000-4000-8000-000000000001';
const participantId = '20000000-0000-4000-8000-000000000002';
const input = {
  eventId,
  title: 'Cena',
  totalCents: 100,
  currency: 'USD',
  splitMode: SplitMode.EXACT,
  occurredAt: new Date('2026-08-21T12:00:00.000Z'),
  participants: [{ eventParticipantId: participantId, shareCents: 100 }],
  payers: [{ eventParticipantId: participantId, amountCents: 100 }],
};

function groups() {
  return {
    requireRole: vi.fn(async () => ({
      id: 'member',
      groupId: 'group',
      userId: 'user',
      role: GroupRole.MEMBER,
    })),
  } as unknown as GroupsService;
}

describe('ExpensesService idempotencia', () => {
  it('reproduce una respuesta vigente sin volver a validar ni persistir', async () => {
    const repository = {
      findIdempotency: vi.fn(async () => ({
        requestHash: requestHash(input),
        responseBody: { id: 'expense' },
        responseStatus: 201,
      })),
      context: vi.fn(),
      createAtomic: vi.fn(),
    } as unknown as ExpensesRepository;
    const service = new ExpensesService(repository, groups());
    await expect(service.create('user', 'group', 'key-12345', 'request', input)).resolves.toEqual({
      data: { id: 'expense' },
      replayed: true,
    });
    expect(repository.context).not.toHaveBeenCalled();
    expect(repository.createAtomic).not.toHaveBeenCalled();
  });

  it('continúa hasta createAtomic cuando no hay una respuesta vigente', async () => {
    const repository = {
      findIdempotency: vi.fn(async () => null),
      context: vi.fn(async () => ({
        id: eventId,
        status: EventStatus.OPEN,
        settlement: null,
        group: { currency: 'USD' },
        participants: [{ id: participantId, groupMemberId: 'member' }],
      })),
      createAtomic: vi.fn(async () => ({
        data: { id: 'expense' },
        replayed: false,
        requestHash: requestHash(input),
      })),
    } as unknown as ExpensesRepository;
    const service = new ExpensesService(repository, groups());
    await expect(service.create('user', 'group', 'key-12345', 'request', input)).resolves.toEqual({
      data: { id: 'expense' },
      replayed: false,
    });
    expect(repository.createAtomic).toHaveBeenCalledOnce();
  });
});
