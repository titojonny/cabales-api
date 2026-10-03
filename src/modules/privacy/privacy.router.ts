import { Router, type RequestHandler } from 'express';
import type { AppConfig } from '../../config/env.js';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody } from '../../shared/validation.js';
import {
  confirmPrivacyRequestSchema,
  createPrivacyRequestSchema,
  type ConfirmPrivacyRequestInput,
  type CreatePrivacyRequestInput,
} from './privacy.schema.js';
import type { PrivacyService } from './privacy.service.js';

/** Derechos ARCO-POL del titular autenticado. */
export function createPrivacyRouter(
  service: PrivacyService,
  config: AppConfig,
  limit?: RequestHandler,
): Router {
  const router = Router();
  const limited: RequestHandler = limit ?? ((_req, _res, next) => next());

  router.post('/requests', limited, validateBody(createPrivacyRequestSchema), async (req, res) => {
    sendData(
      res,
      await service.create(req.auth!.userId, req.body as CreatePrivacyRequestInput, req.requestId),
      201,
    );
  });
  router.get('/requests', async (req, res) => sendData(res, await service.list(req.auth!.userId)));
  router.get('/requests/:requestId', async (req, res) => {
    sendData(res, await service.get(req.auth!.userId, uuidParam(req.params['requestId'])));
  });
  router.post(
    '/requests/:requestId/confirm',
    limited,
    validateBody(confirmPrivacyRequestSchema),
    async (req, res) => {
      const result = await service.confirm(
        req.auth!.userId,
        uuidParam(req.params['requestId']),
        req.body as ConfirmPrivacyRequestInput,
        req.requestId,
      );
      if (result.type === 'ERASURE' && result.status === 'COMPLETED') {
        const options = { secure: config.isProduction, sameSite: 'lax' as const, path: '/' };
        res.clearCookie(config.COOKIE_NAME, options);
        res.clearCookie(`${config.COOKIE_NAME}_csrf`, options);
      }
      sendData(res, result);
    },
  );
  router.post('/requests/:requestId/cancel', limited, async (req, res) => {
    sendData(
      res,
      await service.cancel(req.auth!.userId, uuidParam(req.params['requestId']), req.requestId),
    );
  });
  router.get('/requests/:requestId/export', limited, async (req, res) => {
    const data = await service.export(
      req.auth!.userId,
      uuidParam(req.params['requestId']),
      req.requestId,
    );
    const date = new Date().toISOString().slice(0, 10);
    res.setHeader('Content-Disposition', `attachment; filename="cabales-export-${date}.json"`);
    sendData(res, data);
  });
  return router;
}
