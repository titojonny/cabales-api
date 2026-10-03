import { describe, expect, it, vi } from 'vitest';
import { EventRemindersService } from '../src/modules/events/event-reminders.service.js';
import type { EventsRepository } from '../src/modules/events/events.repository.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';

const eventId = '40000000-0000-4000-8000-000000000004';
const groupId = '30000000-0000-4000-8000-000000000003';
const reminderId = '60000000-0000-4000-8000-000000000006';
const userId = '10000000-0000-4000-8000-000000000001';

describe('EventRemindersService', () => {
  it('solo avisa una vez por clave y recibe únicamente participantes no rechazados', async () => {
    const notify = vi.fn(async () => 1);
    const repository = {
      dueReminders: vi.fn(async () => [
        {
          id: reminderId,
          minutesBefore: 60,
          event: {
            id: eventId,
            groupId,
            name: 'Cena real',
            startsAt: new Date('2026-10-03T13:00:00.000Z'),
            timeZone: 'America/El_Salvador',
          },
        },
      ]),
      participantsForReminder: vi.fn(async () => [{ groupMember: { userId } }]),
    } as unknown as EventsRepository;
    const notifications = { notify } as unknown as NotificationsService;
    const service = new EventRemindersService(repository, notifications);

    await service.run(new Date('2026-10-03T12:01:00.000Z'));
    await service.run(new Date('2026-10-03T12:02:00.000Z'));

    expect(notify).toHaveBeenCalledTimes(2);
    expect(notify).toHaveBeenLastCalledWith(
      expect.objectContaining({
        type: 'event.reminder',
        userIds: [userId],
        dedupeKey: `event.reminder:${reminderId}`,
      }),
    );
    expect(repository.participantsForReminder).toHaveBeenCalledWith(eventId);
  });

  it('no emite antes de la ventana configurada', async () => {
    const notify = vi.fn(async () => 1);
    const repository = {
      dueReminders: vi.fn(async () => [
        {
          id: reminderId,
          minutesBefore: 1440,
          event: {
            id: eventId,
            groupId,
            name: 'Cena real',
            startsAt: new Date('2026-10-04T13:00:00.000Z'),
            timeZone: null,
          },
        },
      ]),
    } as unknown as EventsRepository;
    const service = new EventRemindersService(repository, {
      notify,
    } as unknown as NotificationsService);

    await service.run(new Date('2026-10-03T12:00:00.000Z'));

    expect(notify).not.toHaveBeenCalled();
  });
});
