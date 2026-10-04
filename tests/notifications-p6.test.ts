import { describe, expect, it, vi } from 'vitest';
import { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import type { NotificationPushProvider } from '../src/infrastructure/push.js';

describe('push de avisos P6', () => {
  it('envia recordatorios de eventos y documentos solo con preferencia push activa', async () => {
    const send = vi.fn(async () => true);
    let pushEnabled = true;
    const db = {
      user: {
        findUnique: vi.fn(async () => ({
          email: 'persona@example.test',
          isActive: true,
          emailVerifiedAt: null,
        })),
      },
      notificationPreference: {
        findMany: vi.fn(async () => [
          { type: 'event.reminder', inApp: true, email: false, push: pushEnabled },
          { type: 'document.expiring', inApp: true, email: false, push: pushEnabled },
        ]),
      },
      notification: { create: vi.fn(async () => undefined) },
      pushSubscription: {
        findMany: vi.fn(async () => [
          { endpoint: 'https://push.example/sub', p256dh: 'public', auth: 'auth' },
        ]),
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    };
    const push = { enabled: true, send } as unknown as NotificationPushProvider;
    const service = new NotificationsService(db as never, {
      push,
      appOrigin: 'https://app.example',
    });

    await service.notify({
      userIds: ['user-id'],
      type: 'event.reminder',
      title: 'Evento',
      body: 'Ahora',
    });
    await service.notify({
      userIds: ['user-id'],
      type: 'document.expiring',
      title: 'Documento',
      body: 'Pronto',
    });
    pushEnabled = false;
    await service.notify({
      userIds: ['user-id'],
      type: 'event.reminder',
      title: 'Silenciado',
      body: 'No enviar',
    });

    expect(send).toHaveBeenCalledTimes(2);
    expect(send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ endpoint: 'https://push.example/sub' }),
      expect.objectContaining({ title: 'Evento' }),
    );
  });
});
