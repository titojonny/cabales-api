import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody } from '../../shared/validation.js';
import { createEventSchema, type CreateEventInput } from './events.schema.js';
import type { EventsService } from './events.service.js';

/** Endpoints de eventos anidados bajo un grupo. */
export function createEventsRouter(service: EventsService): Router {
  const router = Router({ mergeParams: true });
  router.post('/', validateBody(createEventSchema), async (req, res) => {
    sendData(
      res,
      await service.create(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        req.body as CreateEventInput,
      ),
      201,
    );
  });
  router.get('/', async (req, res) => {
    sendData(
      res,
      await service.list(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
      ),
    );
  });
  router.get('/:eventId', async (req, res) => {
    sendData(
      res,
      await service.detail(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['eventId']),
      ),
    );
  });
  return router;
}
