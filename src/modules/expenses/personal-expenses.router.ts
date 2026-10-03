import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import {
  createPersonalExpenseSchema,
  expenseHistoryQuerySchema,
  updatePersonalExpenseSchema,
  type CreatePersonalExpenseInput,
  type ExpenseHistoryQuery,
  type UpdatePersonalExpenseInput,
} from './expenses.schema.js';
import {
  idempotencyHeader,
  uuidParam,
  validateBody,
  validateQuery,
} from '../../shared/validation.js';
import type { PersonalExpensesService } from './personal-expenses.service.js';

/** Gastos personales y el historial unificado autorizado por usuario/membresía. */
export function createPersonalExpensesRouter(
  service: PersonalExpensesService,
  mutationLimit?: RequestHandler,
): Router {
  const router = Router();
  const limit = mutationLimit ?? ((_req, _res, next) => next());
  router.post('/', limit, validateBody(createPersonalExpenseSchema), async (req, res) => {
    const result = await service.create(
      req.auth!.userId,
      idempotencyHeader(req),
      req.requestId,
      req.body as CreatePersonalExpenseInput,
    );
    sendData(res, result.data, result.replayed ? 200 : 201, {
      idempotencyReplayed: result.replayed,
    });
  });
  router.get('/', validateQuery(expenseHistoryQuerySchema), async (req, res) => {
    const result = await service.history(
      req.auth!.userId,
      req.validatedQuery as ExpenseHistoryQuery,
    );
    sendData(res, result.items, 200, {
      total: result.total,
      totalCount: result.totalCount,
      nextCursor: result.nextCursor,
    });
  });
  router.get('/:expenseId', async (req, res) =>
    sendData(res, await service.detail(req.auth!.userId, uuidParam(req.params['expenseId']))),
  );
  router.patch('/:expenseId', limit, validateBody(updatePersonalExpenseSchema), async (req, res) =>
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam(req.params['expenseId']),
        req.body as UpdatePersonalExpenseInput,
      ),
    ),
  );
  router.delete('/:expenseId', limit, async (req, res) => {
    await service.delete(req.auth!.userId, uuidParam(req.params['expenseId']));
    sendData(res, { deleted: true });
  });
  return router;
}
