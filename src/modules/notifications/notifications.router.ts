import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import {
  deletePushSubscriptionSchema,
  listNotificationsQuerySchema,
  pushSubscriptionSchema,
  updatePreferencesSchema,
  type ListNotificationsQuery,
  type PushSubscriptionInput,
  type UpdatePreferencesInput,
} from './notifications.schema.js';
import type { NotificationsService } from './notifications.service.js';

/** Centro de avisos del usuario autenticado. */
export function createNotificationsRouter(service: NotificationsService): Router {
  const router = Router();
  router.get('/', validateQuery(listNotificationsQuerySchema), async (req, res) => {
    const result = await service.list(
      req.auth!.userId,
      req.validatedQuery as ListNotificationsQuery,
    );
    sendData(res, result.items, 200, { nextCursor: result.nextCursor });
  });
  router.get('/unread-count', async (req, res) =>
    sendData(res, await service.unreadCount(req.auth!.userId)),
  );
  router.post('/read-all', async (req, res) =>
    sendData(res, await service.markAllRead(req.auth!.userId)),
  );
  router.get('/preferences', async (req, res) =>
    sendData(res, await service.getPreferences(req.auth!.userId)),
  );
  router.get('/push-config', async (_req, res) => sendData(res, service.getPushConfig()));
  router.put('/preferences', validateBody(updatePreferencesSchema), async (req, res) => {
    sendData(
      res,
      await service.updatePreferences(req.auth!.userId, req.body as UpdatePreferencesInput),
    );
  });
  router.post('/push-subscriptions', validateBody(pushSubscriptionSchema), async (req, res) => {
    sendData(
      res,
      await service.subscribePush(req.auth!.userId, req.body as PushSubscriptionInput),
      201,
    );
  });
  router.delete(
    '/push-subscriptions',
    validateBody(deletePushSubscriptionSchema),
    async (req, res) => {
      sendData(res, await service.unsubscribePush(req.auth!.userId, req.body.endpoint as string));
    },
  );
  router.post('/:notificationId/read', async (req, res) => {
    sendData(
      res,
      await service.markRead(req.auth!.userId, uuidParam(req.params['notificationId'])),
    );
  });
  router.post('/:notificationId/archive', async (req, res) => {
    sendData(res, await service.archive(req.auth!.userId, uuidParam(req.params['notificationId'])));
  });
  return router;
}
