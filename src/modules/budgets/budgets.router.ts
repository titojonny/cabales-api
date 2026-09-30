import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { groupParam, uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import {
  budgetQuerySchema,
  createBudgetSchema,
  updateBudgetSchema,
  type CreateBudgetInput,
  type UpdateBudgetInput,
} from './budgets.schema.js';
import type { BudgetsService } from './budgets.service.js';

/** Presupuestos del grupo; `?at=` consulta el periodo que contiene esa fecha. */
export function createBudgetsRouter(service: BudgetsService): Router {
  const router = Router({ mergeParams: true });
  const at = (query: unknown) => {
    const value = (query as { at?: string }).at;
    return value ? new Date(value) : new Date();
  };
  router.get('/', validateQuery(budgetQuerySchema), async (req, res) => {
    sendData(res, await service.list(req.auth!.userId, groupParam(req), at(req.validatedQuery)));
  });
  router.post('/', validateBody(createBudgetSchema), async (req, res) => {
    sendData(
      res,
      await service.create(req.auth!.userId, groupParam(req), req.body as CreateBudgetInput),
      201,
    );
  });
  router.get('/:budgetId', validateQuery(budgetQuerySchema), async (req, res) => {
    sendData(
      res,
      await service.detail(
        req.auth!.userId,
        groupParam(req),
        uuidParam(req.params['budgetId']),
        at(req.validatedQuery),
      ),
    );
  });
  router.patch('/:budgetId', validateBody(updateBudgetSchema), async (req, res) => {
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        groupParam(req),
        uuidParam(req.params['budgetId']),
        req.body as UpdateBudgetInput,
      ),
    );
  });
  router.delete('/:budgetId', async (req, res) => {
    await service.remove(req.auth!.userId, groupParam(req), uuidParam(req.params['budgetId']));
    sendData(res, { deleted: true });
  });
  return router;
}
