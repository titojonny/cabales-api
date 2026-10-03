import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { groupParam, uuidParam, validateBody } from '../../shared/validation.js';
import {
  createGroupRecurringSchema,
  createPersonalRecurringSchema,
  updateRecurringSchema,
  type CreateGroupRecurringInput,
  type CreatePersonalRecurringInput,
  type UpdateRecurringInput,
} from './recurring-expenses.schema.js';
import type { RecurringExpensesService } from './recurring-expenses.service.js';

function personalRouter(service: RecurringExpensesService, mutationLimit?: RequestHandler) {
  const router = Router();
  const limit = mutationLimit ?? ((_req, _res, next) => next());
  router.get('/', async (req, res) => sendData(res, await service.listPersonal(req.auth!.userId)));
  router.post('/', limit, validateBody(createPersonalRecurringSchema), async (req, res) =>
    sendData(
      res,
      await service.createPersonal(req.auth!.userId, req.body as CreatePersonalRecurringInput),
      201,
    ),
  );
  router.patch('/:recurringId', limit, validateBody(updateRecurringSchema), async (req, res) =>
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam(req.params['recurringId']),
        req.body as UpdateRecurringInput,
      ),
    ),
  );
  router.post('/:recurringId/pause', limit, async (req, res) =>
    sendData(
      res,
      await service.setActive(req.auth!.userId, uuidParam(req.params['recurringId']), false),
    ),
  );
  router.post('/:recurringId/resume', limit, async (req, res) =>
    sendData(
      res,
      await service.setActive(req.auth!.userId, uuidParam(req.params['recurringId']), true),
    ),
  );
  router.delete('/:recurringId', limit, async (req, res) => {
    await service.delete(req.auth!.userId, uuidParam(req.params['recurringId']));
    sendData(res, { deleted: true });
  });
  return router;
}

export function createPersonalRecurringRouter(
  service: RecurringExpensesService,
  mutationLimit?: RequestHandler,
): Router {
  return personalRouter(service, mutationLimit);
}

export function createGroupRecurringRouter(
  service: RecurringExpensesService,
  mutationLimit?: RequestHandler,
): Router {
  const router = Router({ mergeParams: true });
  const limit = mutationLimit ?? ((_req, _res, next) => next());
  router.get('/', async (req, res) =>
    sendData(res, await service.listGroup(req.auth!.userId, groupParam(req))),
  );
  router.post('/', limit, validateBody(createGroupRecurringSchema), async (req, res) =>
    sendData(
      res,
      await service.createGroup(
        req.auth!.userId,
        groupParam(req),
        req.body as CreateGroupRecurringInput,
      ),
      201,
    ),
  );
  router.patch('/:recurringId', limit, validateBody(updateRecurringSchema), async (req, res) =>
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam(req.params['recurringId']),
        req.body as UpdateRecurringInput,
        groupParam(req),
      ),
    ),
  );
  router.post('/:recurringId/pause', limit, async (req, res) =>
    sendData(
      res,
      await service.setActive(
        req.auth!.userId,
        uuidParam(req.params['recurringId']),
        false,
        groupParam(req),
      ),
    ),
  );
  router.post('/:recurringId/resume', limit, async (req, res) =>
    sendData(
      res,
      await service.setActive(
        req.auth!.userId,
        uuidParam(req.params['recurringId']),
        true,
        groupParam(req),
      ),
    ),
  );
  router.delete('/:recurringId', limit, async (req, res) => {
    await service.delete(req.auth!.userId, uuidParam(req.params['recurringId']), groupParam(req));
    sendData(res, { deleted: true });
  });
  return router;
}
