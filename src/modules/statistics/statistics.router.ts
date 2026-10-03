import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { validateQuery } from '../../shared/validation.js';
import {
  statisticsQuerySchema,
  type StatisticsQuery,
  type StatisticsService,
} from './statistics.service.js';

/** Resumen estadístico por periodo, categoría, grupo, evento y persona. */
export function createStatisticsRouter(
  service: StatisticsService,
  exportLimit?: RequestHandler,
  maxRows = 1000,
): Router {
  const router = Router();
  router.get('/summary', validateQuery(statisticsQuerySchema), async (req, res) => {
    sendData(res, await service.summary(req.auth!.userId, req.validatedQuery as StatisticsQuery));
  });
  router.get('/summary/export', exportLimit ?? ((_req, _res, next) => next()), validateQuery(statisticsQuerySchema), async (req, res) => {
    const result = await service.exportCsv(req.auth!.userId, req.validatedQuery as StatisticsQuery, maxRows);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="cabales-statistics.csv"');
    res.status(200).send(result.csv);
  });
  return router;
}
