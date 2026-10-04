import { Router, type Request, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import {
  calendarQuerySchema,
  commentSchema,
  createShareLinkSchema,
  eventFundsSchema,
  type CalendarQuery,
  type CommentInput,
  type CreateShareLinkInput,
  type EventFundsInput,
} from './collaboration.schema.js';
import type { CollaborationService } from './collaboration.service.js';

const id = (value: string | string[] | undefined) => uuidParam(value);

export function createGroupCollaborationRouter(
  service: CollaborationService,
  options: { writeLimit?: RequestHandler } = {},
): Router {
  const router = Router({ mergeParams: true });
  const writeLimit = options.writeLimit ?? ((_req, _res, next) => next());
  router.post(
    '/:groupId/share-links',
    writeLimit,
    validateBody(createShareLinkSchema),
    async (req, res) =>
      sendData(
        res,
        await service.createShareLink(
          req.auth!.userId,
          id(req.params['groupId']),
          req.body as CreateShareLinkInput,
        ),
        201,
      ),
  );
  router.get('/:groupId/share-links', async (req, res) =>
    sendData(res, await service.listShareLinks(req.auth!.userId, id(req.params['groupId']))),
  );
  router.post('/:groupId/share-links/:linkId/revoke', writeLimit, async (req, res) => {
    await service.revokeShareLink(
      req.auth!.userId,
      id(req.params['groupId']),
      id(req.params['linkId']),
    );
    sendData(res, { revoked: true });
  });
  return router;
}

export function createEventCollaborationRouter(
  service: CollaborationService,
  options: { writeLimit?: RequestHandler } = {},
): Router {
  const router = Router({ mergeParams: true });
  const writeLimit = options.writeLimit ?? ((_req, _res, next) => next());
  const group = (req: Request) => id(req.params['groupId']);
  router.get('/:eventId/repeat-template', async (req, res) =>
    sendData(
      res,
      await service.repeatEvent(req.auth!.userId, group(req), id(req.params['eventId'])),
    ),
  );
  router.get('/:eventId/comments', async (req, res) =>
    sendData(
      res,
      await service.listComments(req.auth!.userId, group(req), id(req.params['eventId'])),
    ),
  );
  router.post('/:eventId/comments', writeLimit, validateBody(commentSchema), async (req, res) =>
    sendData(
      res,
      await service.createComment(
        req.auth!.userId,
        group(req),
        id(req.params['eventId']),
        req.body as CommentInput,
      ),
      201,
    ),
  );
  router.patch(
    '/:eventId/comments/:commentId',
    writeLimit,
    validateBody(commentSchema),
    async (req, res) =>
      sendData(
        res,
        await service.updateComment(
          req.auth!.userId,
          group(req),
          id(req.params['eventId']),
          id(req.params['commentId']),
          req.body as CommentInput,
        ),
      ),
  );
  router.delete('/:eventId/comments/:commentId', writeLimit, async (req, res) => {
    await service.deleteComment(
      req.auth!.userId,
      group(req),
      id(req.params['eventId']),
      id(req.params['commentId']),
    );
    sendData(res, { deleted: true });
  });
  router.put('/:eventId/funds', writeLimit, validateBody(eventFundsSchema), async (req, res) =>
    sendData(
      res,
      await service.replaceEventFunds(
        req.auth!.userId,
        group(req),
        id(req.params['eventId']),
        req.body as EventFundsInput,
      ),
    ),
  );
  router.get('/:eventId/funds', async (req, res) =>
    sendData(
      res,
      await service.eventFunds(req.auth!.userId, group(req), id(req.params['eventId'])),
    ),
  );
  return router;
}

export function createExpenseCollaborationRouter(service: CollaborationService): Router {
  const router = Router({ mergeParams: true });
  router.get('/:expenseId/repeat-template', async (req, res) =>
    sendData(
      res,
      await service.repeatExpense(
        req.auth!.userId,
        id((req.params as Record<string, string | undefined>)['groupId']),
        id(req.params['expenseId']),
      ),
    ),
  );
  return router;
}

export function createPublicShareRouter(service: CollaborationService): Router {
  const router = Router();
  router.get('/:token', async (req, res) =>
    sendData(res, await service.publicSummary(req.params['token'] ?? '')),
  );
  return router;
}

export function createCalendarRouter(service: CollaborationService): Router {
  const router = Router();
  router.get('/events', validateQuery(calendarQuerySchema), async (req, res) =>
    sendData(res, await service.calendar(req.auth!.userId, req.validatedQuery as CalendarQuery)),
  );
  return router;
}
