import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { idempotencyHeader, uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import { createExpenseSchema, groupExpenseQuerySchema, type CreateExpenseInput, type GroupExpenseQuery } from './expenses.schema.js';
import type { ExpensesService } from './expenses.service.js';

/** Endpoints financieros de gastos anidados bajo el grupo. */
export function createExpensesRouter(
  service: ExpensesService,
  createLimit?: RequestHandler,
): Router {
  const router = Router({ mergeParams: true });
  router.post(
    '/',
    createLimit ?? ((_req, _res, next) => next()),
    validateBody(createExpenseSchema),
    async (req, res) => {
      const result = await service.create(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        idempotencyHeader(req),
        req.requestId,
        req.body as CreateExpenseInput,
      );
      sendData(res, result.data, result.replayed ? 200 : 201, {
        idempotencyReplayed: result.replayed,
      });
    },
  );
  router.get('/', validateQuery(groupExpenseQuerySchema), async (req, res) => {
    sendData(
      res,
      await service.list(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        req.validatedQuery as GroupExpenseQuery,
      ),
    );
  });
  router.get('/:expenseId', async (req, res) => {
    sendData(
      res,
      await service.detail(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['expenseId']),
      ),
    );
  });
  return router;
}
