import { GroupRole } from '@prisma/client';
import { ensure } from '../../shared/errors.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { CreateEventInput } from './events.schema.js';
import type { EventsRepository } from './events.repository.js';

/** Reglas de contexto para eventos y participantes. */
export class EventsService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly groups: GroupsService,
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
    return this.repository.create(groupId, userId, membership.id, input);
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
    return event;
  }
}
