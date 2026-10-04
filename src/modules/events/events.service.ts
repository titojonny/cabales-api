import { GroupRole } from '@prisma/client';
import { ensure } from '../../shared/errors.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { DomainEvents } from '../../shared/events.js';
import type {
  CreateEventInput,
  EventRemindersInput,
  RsvpInput,
  UpdateEventInput,
} from './events.schema.js';
import type { EventsRepository } from './events.repository.js';

/** Reglas de contexto para eventos y participantes. */
export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly groups: GroupsService,
    private readonly events?: DomainEvents,
  ) {}

  async create(userId: string, groupId: string, input: CreateEventInput) {
    const membership = await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const uniqueMembers = [...new Set(input.memberIds)];
    ensure(
      uniqueMembers.length === input.memberIds.length,
      422,
      'DUPLICATE_PARTICIPANT',
      'Hay miembros duplicados',
    );
    const uniqueGuests = new Set(input.guests.map((name) => name.toLocaleLowerCase('es')));
    ensure(
      uniqueGuests.size === input.guests.length,
      422,
      'DUPLICATE_PARTICIPANT',
      'Hay invitados duplicados',
    );
    const found = await this.repository.findMembers(groupId, uniqueMembers);
    ensure(
      found.length === uniqueMembers.length,
      422,
      'PARTICIPANT_OUTSIDE_GROUP',
      'Un participante no pertenece al grupo',
    );
    const event = await this.repository.create(groupId, userId, membership.id, input);
    this.events?.emit({ type: 'event.created', groupId, eventId: event.id, userId });
    return event;
  }

  async list(userId: string, groupId: string) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    return this.repository.list(groupId);
  }

  async detail(userId: string, groupId: string, eventId: string) {
    await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const event = await this.repository.detail(groupId, eventId);
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return this.withRsvpCounts(event);
  }

  async update(userId: string, groupId: string, eventId: string, input: UpdateEventInput) {
    const current = await this.requireManagerOrCreator(userId, groupId, eventId);
    const startsAt = input.startsAt ?? current.startsAt;
    const endsAt = input.endsAt === undefined ? current.endsAt : input.endsAt;
    ensure(
      endsAt === null || endsAt === undefined || endsAt >= startsAt,
      422,
      'INVALID_EVENT_RANGE',
      'La fecha de fin debe ser posterior o igual al inicio',
    );
    const event = await this.repository.update(groupId, eventId, input);
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return this.withRsvpCounts(event);
  }

  async cancel(userId: string, groupId: string, eventId: string) {
    await this.requireManagerOrCreator(userId, groupId, eventId);
    const event = await this.repository.cancel(groupId, eventId);
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return this.withRsvpCounts(event);
  }

  async delete(userId: string, groupId: string, eventId: string): Promise<void> {
    await this.requireManagerOrCreator(userId, groupId, eventId);
    const outcome = await this.repository.deleteEmptyAtomic(groupId, eventId);
    ensure(outcome !== 'NOT_FOUND', 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    ensure(
      outcome !== 'BLOCKED',
      409,
      'EVENT_HAS_FINANCIAL_ACTIVITY',
      'No se puede eliminar el evento porque tiene gastos o una liquidacion',
    );
  }

  async rsvp(userId: string, groupId: string, eventId: string, input: RsvpInput) {
    const membership = await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const updated = await this.repository.updateRsvp(groupId, eventId, membership.id, input.status);
    ensure(
      updated === 1,
      404,
      'EVENT_PARTICIPANT_NOT_FOUND',
      'No eres participante de este evento',
    );
    const event = await this.repository.detail(groupId, eventId);
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return this.withRsvpCounts(event);
  }

  async replaceReminders(
    userId: string,
    groupId: string,
    eventId: string,
    input: EventRemindersInput,
  ) {
    await this.requireManagerOrCreator(userId, groupId, eventId);
    const event = await this.repository.replaceReminders(groupId, eventId, input);
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    return this.withRsvpCounts(event);
  }

  private async requireManagerOrCreator(userId: string, groupId: string, eventId: string) {
    const membership = await this.groups.requireRole(userId, groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const event = await this.repository.access(groupId, eventId);
    ensure(event, 404, 'EVENT_NOT_FOUND', 'Evento no encontrado');
    ensure(
      event.createdById === userId ||
        membership.role === GroupRole.OWNER ||
        membership.role === GroupRole.ADMIN,
      403,
      'FORBIDDEN',
      'Solo la persona creadora o un administrador puede gestionar este evento',
    );
    return event;
  }

  private withRsvpCounts<T extends { participants: Array<{ rsvpStatus: string }> }>(event: T) {
    const rsvpCounts = {
      PENDING: event.participants.filter((participant) => participant.rsvpStatus === 'PENDING')
        .length,
      GOING: event.participants.filter((participant) => participant.rsvpStatus === 'GOING').length,
      MAYBE: event.participants.filter((participant) => participant.rsvpStatus === 'MAYBE').length,
      DECLINED: event.participants.filter((participant) => participant.rsvpStatus === 'DECLINED')
        .length,
    };
    return { ...event, rsvpCounts };
  }
}
