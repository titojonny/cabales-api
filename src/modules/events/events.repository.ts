import type { Database } from '../../database/client.js';
import type { CreateEventInput, EventRemindersInput, UpdateEventInput } from './events.schema.js';

const eventView = {
  id: true,
  groupId: true,
  name: true,
  description: true,
  startsAt: true,
  endsAt: true,
  locationName: true,
  locationAddress: true,
  mapsUrl: true,
  timeZone: true,
  status: true,
  createdById: true,
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
        endsAt: input.endsAt ?? null,
        locationName: input.locationName ?? null,
        locationAddress: input.locationAddress ?? null,
        mapsUrl: input.mapsUrl ?? null,
        timeZone: input.timeZone ?? null,
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
        participants: {
          select: {
            id: true,
            groupMemberId: true,
            guestName: true,
            rsvpStatus: true,
            respondedAt: true,
          },
        },
      },
    });
  }

  list(groupId: string) {
    return this.db.event.findMany({
      where: { groupId },
      take: 100,
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
            rsvpStatus: true,
            respondedAt: true,
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
        reminders: {
          select: { id: true, minutesBefore: true, enabled: true },
          orderBy: { minutesBefore: 'desc' },
        },
        settlement: { select: { id: true, status: true, createdAt: true } },
        _count: { select: { expenses: true } },
      },
    });
  }

  access(groupId: string, eventId: string) {
    return this.db.event.findFirst({
      where: { id: eventId, groupId },
      select: { id: true, createdById: true, startsAt: true, endsAt: true, status: true },
    });
  }

  async update(groupId: string, eventId: string, input: UpdateEventInput) {
    await this.db.$transaction(async (tx) => {
      const data = {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.description !== undefined ? { description: input.description } : {}),
        ...(input.startsAt !== undefined ? { startsAt: input.startsAt } : {}),
        ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
        ...(input.locationName !== undefined ? { locationName: input.locationName } : {}),
        ...(input.locationAddress !== undefined ? { locationAddress: input.locationAddress } : {}),
        ...(input.mapsUrl !== undefined ? { mapsUrl: input.mapsUrl } : {}),
        ...(input.timeZone !== undefined ? { timeZone: input.timeZone } : {}),
      };
      if (Object.keys(data).length > 0)
        await tx.event.updateMany({ where: { id: eventId, groupId }, data });
      if (input.links !== undefined) {
        await tx.eventLink.deleteMany({ where: { eventId } });
        if (input.links.length > 0)
          await tx.eventLink.createMany({
            data: input.links.map((link) => ({ ...link, eventId })),
          });
      }
    });
    return this.detail(groupId, eventId);
  }

  async cancel(groupId: string, eventId: string) {
    await this.db.event.updateMany({
      where: { id: eventId, groupId },
      data: { status: 'CANCELLED' },
    });
    return this.detail(groupId, eventId);
  }

  async deleteEmptyAtomic(groupId: string, eventId: string) {
    return this.db.$transaction(async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, groupId },
        select: {
          id: true,
          _count: { select: { expenses: true } },
          settlement: { select: { id: true } },
        },
      });
      if (!event) return 'NOT_FOUND' as const;
      if (event._count.expenses > 0 || event.settlement) return 'BLOCKED' as const;
      try {
        await tx.event.delete({ where: { id: event.id } });
        return 'DELETED' as const;
      } catch (error) {
        if (error && typeof error === 'object' && 'code' in error && error.code === 'P2003')
          return 'BLOCKED' as const;
        throw error;
      }
    });
  }

  async updateRsvp(groupId: string, eventId: string, groupMemberId: string, status: string) {
    const updated = await this.db.eventParticipant.updateMany({
      where: {
        eventId,
        groupMemberId,
        event: { groupId },
      },
      data: { rsvpStatus: status as never, respondedAt: new Date() },
    });
    return updated.count;
  }

  async replaceReminders(groupId: string, eventId: string, input: EventRemindersInput) {
    await this.db.$transaction(async (tx) => {
      const event = await tx.event.findFirst({
        where: { id: eventId, groupId },
        select: { id: true },
      });
      if (!event) return;
      await tx.eventReminder.deleteMany({ where: { eventId } });
      if (input.reminders.length > 0)
        await tx.eventReminder.createMany({
          data: input.reminders.map((reminder) => ({ ...reminder, eventId })),
        });
    });
    return this.detail(groupId, eventId);
  }

  dueReminders(now: Date) {
    return this.db.eventReminder.findMany({
      where: {
        enabled: true,
        event: {
          status: 'OPEN',
          startsAt: { gt: now },
        },
      },
      select: {
        id: true,
        minutesBefore: true,
        event: { select: { id: true, groupId: true, name: true, startsAt: true, timeZone: true } },
      },
    });
  }

  participantsForReminder(eventId: string) {
    return this.db.eventParticipant.findMany({
      where: {
        eventId,
        rsvpStatus: { in: ['PENDING', 'GOING', 'MAYBE'] },
        groupMemberId: { not: null },
      },
      select: { groupMember: { select: { userId: true } } },
    });
  }
}
