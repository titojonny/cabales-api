import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import { confirmOcrJobSchema, createOcrJobSchema, listOcrJobsQuerySchema } from './ocr.schema.js';
import type { OcrService } from './ocr.service.js';

/** Trabajos OCR del usuario autenticado. */
export function createOcrRouter(service: OcrService, limit?: RequestHandler): Router {
  const router = Router();
  const limited: RequestHandler = limit ?? ((_req, _res, next) => next());
  router.post('/jobs', limited, validateBody(createOcrJobSchema), async (req, res) => {
    sendData(
      res,
      await service.create(req.auth!.userId, req.body.documentId as string, req.requestId),
      202,
    );
  });
  router.get('/jobs', validateQuery(listOcrJobsQuerySchema), async (req, res) => {
    const { documentId } = req.validatedQuery as { documentId?: string };
    sendData(res, await service.list(req.auth!.userId, documentId));
  });
  router.get('/jobs/:jobId', async (req, res) => {
    sendData(res, await service.get(req.auth!.userId, uuidParam(req.params['jobId'])));
  });
  router.post('/jobs/:jobId/retry', limited, async (req, res) => {
    sendData(res, await service.retry(req.auth!.userId, uuidParam(req.params['jobId'])), 202);
  });
  router.post('/jobs/:jobId/confirm', validateBody(confirmOcrJobSchema), async (req, res) => {
    sendData(
      res,
      await service.confirm(
        req.auth!.userId,
        uuidParam(req.params['jobId']),
        req.body.expenseId as string,
        req.requestId,
      ),
    );
  });
  return router;
}
