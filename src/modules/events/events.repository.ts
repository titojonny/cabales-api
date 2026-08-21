import type { Database } from '../../database/client.js';
import type { CreateEventInput } from './events.schema.js';

const eventView = {
  id: true,
  groupId: true,
  name: true,
  description: true,
  startsAt: true,
  status: true,
  createdAt: true,
} as const;

/** Consultas y escritura de eventos y su padrón canónico. */
export class EventsRepository {
  constructor(private readonly db: Database) {}

  findMembers(groupId: string, memberIds: string[]) {
    return this.db.groupMember.findMany({
      where: { groupId, id: { in: memberIds } },
      select: { id: true },
    });
  }

  create(groupId: string, userId: string, creatorMemberId: string, input: CreateEventInput) {
    const memberIds = [...new Set([creatorMemberId, ...input.memberIds])];
    return this.db.event.create({
      data: {
        groupId,
        createdById: userId,
        name: input.name,
        ...(input.description ? { description: input.description } : {}),
        startsAt: input.startsAt,
        participants: {
          create: [
            ...memberIds.map((groupMemberId) => ({ groupMemberId })),
            ...input.guests.map((guestName) => ({ guestName })),
          ],
        },
        links: { create: input.links },
      },
      select: {
        ...eventView,
        participants: { select: { id: true, groupMemberId: true, guestName: true } },
      },
    });
  }

  list(groupId: string) {
    return this.db.event.findMany({
      where: { groupId },
      select: {
        ...eventView,
        _count: { select: { participants: true, expenses: true } },
        settlement: { select: { id: true, status: true } },
      },
      orderBy: [{ startsAt: 'desc' }, { id: 'asc' }],
    });
  }

  detail(groupId: string, eventId: string) {
    return this.db.event.findFirst({
      where: { id: eventId, groupId },
      select: {
        ...eventView,
        participants: {
          select: {
            id: true,
            guestName: true,
            groupMember: {
              select: {
                id: true,
                user: { select: { id: true, displayName: true, avatarUrl: true } },
              },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        links: { select: { id: true, label: true, url: true } },
        settlement: { select: { id: true, status: true, createdAt: true } },
        _count: { select: { expenses: true } },
      },
    });
  }
}
