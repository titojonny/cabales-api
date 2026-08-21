import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { idempotencyHeader, uuidParam, validateBody } from '../../shared/validation.js';
import { createExpenseSchema, type CreateExpenseInput } from './expenses.schema.js';
import type { ExpensesService } from './expenses.service.js';

/** Endpoints financieros de gastos anidados bajo el grupo. */
export function createExpensesRouter(service: ExpensesService): Router {
  const router = Router({ mergeParams: true });
  router.post('/', validateBody(createExpenseSchema), async (req, res) => {
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
