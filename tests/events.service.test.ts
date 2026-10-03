import { GroupRole } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { EventsService } from '../src/modules/events/events.service.js';
import type { EventsRepository } from '../src/modules/events/events.repository.js';
import type { GroupsService } from '../src/modules/groups/groups.service.js';

const ids = {
  user: '10000000-0000-4000-8000-000000000001',
  other: '20000000-0000-4000-8000-000000000002',
  group: '30000000-0000-4000-8000-000000000003',
  event: '40000000-0000-4000-8000-000000000004',
  member: '50000000-0000-4000-8000-000000000005',
};

function eventDetail() {
  return {
    id: ids.event,
    groupId: ids.group,
    name: 'Cena',
    description: null,
    startsAt: new Date('2026-10-04T12:00:00.000Z'),
    endsAt: null,
    locationName: null,
    locationAddress: null,
    mapsUrl: null,
    timeZone: null,
    status: 'OPEN' as const,
    createdById: ids.user,
    createdAt: new Date(),
    participants: [
      {
        id: ids.member,
        guestName: null,
        rsvpStatus: 'PENDING',
        respondedAt: null,
        groupMember: {
          id: ids.member,
          user: { id: ids.user, displayName: 'Ana', avatarUrl: null },
        },
      },
    ],
    links: [],
    reminders: [],
    settlement: null,
    _count: { expenses: 0 },
  };
}

type TestEventAccess = {
  id: string;
  createdById: string;
  startsAt: Date;
  endsAt: Date | null;
  status: 'OPEN' | 'CLOSED' | 'CANCELLED';
};

type RepositoryOverrides = {
  access?: () => Promise<TestEventAccess>;
  deleteEmptyAtomic?: () => Promise<'DELETED' | 'BLOCKED' | 'NOT_FOUND'>;
};

function service(overrides: RepositoryOverrides = {}) {
  const repository = {
    access: vi.fn(async (): Promise<TestEventAccess> => ({
      id: ids.event,
      createdById: ids.user,
      startsAt: new Date('2026-10-04T12:00:00.000Z'),
      endsAt: null,
      status: 'OPEN' as const,
    })),
    detail: vi.fn(async () => eventDetail()),
    update: vi.fn(async () => eventDetail()),
    updateRsvp: vi.fn(async () => 1),
    deleteEmptyAtomic: vi.fn(async () => 'DELETED' as const),
    ...overrides,
  } as unknown as EventsRepository;
  const groups = {
    requireRole: vi.fn(async () => ({
      id: ids.member,
      groupId: ids.group,
      userId: ids.user,
      role: GroupRole.MEMBER,
    })),
  } as unknown as GroupsService;
  return { events: new EventsService(repository, groups), repository, groups };
}

describe('EventsService P3', () => {
  it('impide editar a otro miembro que no creó el evento', async () => {
    const { events, repository } = service({
      access: vi.fn(async (): Promise<TestEventAccess> => ({
        id: ids.event,
        createdById: ids.other,
        startsAt: new Date(),
        endsAt: null,
        status: 'OPEN' as const,
      })),
    });
    await expect(
      events.update(ids.user, ids.group, ids.event, { name: 'Otro nombre' }),
    ).rejects.toMatchObject({
      status: 403,
      code: 'FORBIDDEN',
    });
    expect(repository.update).not.toHaveBeenCalled();
  });

  it('responde el RSVP usando la membresía autenticada, nunca un participante recibido', async () => {
    const { events, repository } = service();
    await events.rsvp(ids.user, ids.group, ids.event, { status: 'GOING' });
    expect(repository.updateRsvp).toHaveBeenCalledWith(ids.group, ids.event, ids.member, 'GOING');
  });

  it('bloquea el borrado si existe actividad financiera', async () => {
    const { events } = service({ deleteEmptyAtomic: vi.fn(async () => 'BLOCKED' as const) });
    await expect(events.delete(ids.user, ids.group, ids.event)).rejects.toMatchObject({
      status: 409,
      code: 'EVENT_HAS_FINANCIAL_ACTIVITY',
    });
  });
});
