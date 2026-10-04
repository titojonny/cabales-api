import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import {
  createIncomeSchema,
  incomeQuerySchema,
  updateIncomeSchema,
  type CreateIncomeInput,
  type IncomeQuery,
  type UpdateIncomeInput,
} from './incomes.schema.js';
import type { IncomesService } from './incomes.service.js';

export function createIncomesRouter(service: IncomesService): Router {
  const router = Router();
  router.get('/', validateQuery(incomeQuerySchema), async (req, res) => {
    sendData(res, await service.list(req.auth!.userId, req.validatedQuery as IncomeQuery));
  });
  router.post('/', validateBody(createIncomeSchema), async (req, res) => {
    sendData(res, await service.create(req.auth!.userId, req.body as CreateIncomeInput), 201);
  });
  router.patch('/:incomeId', validateBody(updateIncomeSchema), async (req, res) => {
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam(req.params['incomeId']),
        req.body as UpdateIncomeInput,
      ),
    );
  });
  router.delete('/:incomeId', async (req, res) => {
    await service.remove(req.auth!.userId, uuidParam(req.params['incomeId']));
    sendData(res, { deleted: true });
  });
  return router;
}
