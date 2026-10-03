import type { EventsRepository } from './events.repository.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

const MINUTE_MS = 60_000;

/** Genera recordatorios desde datos persistidos; la notificación aporta la idempotencia final. */
export class EventRemindersService {
  constructor(
    private readonly repository: EventsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<void> {
    const reminders = await this.repository.dueReminders(now);
    for (const reminder of reminders) {
      const dueAt = reminder.event.startsAt.getTime() - reminder.minutesBefore * MINUTE_MS;
      if (dueAt > now.getTime()) continue;
      const participants = await this.repository.participantsForReminder(reminder.event.id);
      const userIds = participants.flatMap((participant) =>
        participant.groupMember ? [participant.groupMember.userId] : [],
      );
      if (userIds.length === 0) continue;
      await this.notifications.notify({
        userIds,
        type: 'event.reminder',
        title: `Recordatorio: ${reminder.event.name}`,
        body: `El evento empieza ${formatOffset(reminder.minutesBefore)}.`,
        data: {
          groupId: reminder.event.groupId,
          eventId: reminder.event.id,
          startsAt: reminder.event.startsAt.toISOString(),
        },
        dedupeKey: `event.reminder:${reminder.id}`,
      });
    }
  }
}

function formatOffset(minutes: number): string {
  if (minutes % 1440 === 0) return `en ${minutes / 1440} ${minutes / 1440 === 1 ? 'día' : 'días'}`;
  if (minutes % 60 === 0) return `en ${minutes / 60} ${minutes / 60 === 1 ? 'hora' : 'horas'}`;
  return `en ${minutes} minutos`;
}
