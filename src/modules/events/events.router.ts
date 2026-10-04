import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody } from '../../shared/validation.js';
import {
  createEventSchema,
  eventRemindersSchema,
  rsvpSchema,
  updateEventSchema,
  type CreateEventInput,
  type EventRemindersInput,
  type RsvpInput,
  type UpdateEventInput,
} from './events.schema.js';
import type { EventsService } from './events.service.js';

/** Endpoints de eventos anidados bajo un grupo. */
export function createEventsRouter(
  service: EventsService,
  options: { rsvpLimit?: RequestHandler } = {},
): Router {
  const router = Router({ mergeParams: true });
  const rsvpLimit: RequestHandler = options.rsvpLimit ?? ((_req, _res, next) => next());
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
  router.patch('/:eventId', validateBody(updateEventSchema), async (req, res) => {
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['eventId']),
        req.body as UpdateEventInput,
      ),
    );
  });
  router.post('/:eventId/cancel', async (req, res) => {
    sendData(
      res,
      await service.cancel(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['eventId']),
      ),
    );
  });
  router.delete('/:eventId', async (req, res) => {
    await service.delete(
      req.auth!.userId,
      uuidParam((req.params as Record<string, string | undefined>)['groupId']),
      uuidParam(req.params['eventId']),
    );
    res.status(204).send();
  });
  router.put('/:eventId/rsvp', rsvpLimit, validateBody(rsvpSchema), async (req, res) => {
    sendData(
      res,
      await service.rsvp(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['eventId']),
        req.body as RsvpInput,
      ),
    );
  });
  router.put('/:eventId/reminders', validateBody(eventRemindersSchema), async (req, res) => {
    sendData(
      res,
      await service.replaceReminders(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['eventId']),
        req.body as EventRemindersInput,
      ),
    );
  });
  return router;
}
