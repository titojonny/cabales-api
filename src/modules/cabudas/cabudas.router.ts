import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { validateQuery } from '../../shared/validation.js';
import {
  cabudasHistoryQuerySchema,
  cabudasSummaryQuerySchema,
  type CabudasHistoryQuery,
  type CabudasSummaryQuery,
  type CabudasService,
} from './cabudas.service.js';

/** Resumen consolidado de saldos e historial de transferencias del usuario. */
export function createCabudasRouter(service: CabudasService): Router {
  const router = Router();
  router.get('/summary', validateQuery(cabudasSummaryQuerySchema), async (req, res) => {
    sendData(
      res,
      await service.summary(req.auth!.userId, req.validatedQuery as CabudasSummaryQuery),
    );
  });
  router.get('/history', validateQuery(cabudasHistoryQuerySchema), async (req, res) => {
    const result = await service.history(
      req.auth!.userId,
      req.validatedQuery as CabudasHistoryQuery,
    );
    sendData(res, result.items, 200, { nextCursor: result.nextCursor });
  });
  return router;
}
