import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { idempotencyHeader, uuidParam, validateBody } from '../../shared/validation.js';
import { createSettlementSchema, type CreateSettlementInput } from './settlements.schema.js';
import type { SettlementsService } from './settlements.service.js';

/** Endpoints de liquidación y confirmación atómica de transferencias. */
export function createSettlementsRouter(service: SettlementsService): Router {
  const router = Router({ mergeParams: true });
  router.post('/', validateBody(createSettlementSchema), async (req, res) => {
    const result = await service.create(
      req.auth!.userId,
      uuidParam((req.params as Record<string, string | undefined>)['groupId']),
      idempotencyHeader(req),
      req.requestId,
      req.body as CreateSettlementInput,
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
  router.get('/:settlementId', async (req, res) => {
    sendData(
      res,
      await service.detail(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['settlementId']),
      ),
    );
  });
  router.patch('/:settlementId/transfers/:transferId/paid', async (req, res) => {
    sendData(
      res,
      await service.markPaid(
        req.auth!.userId,
        uuidParam((req.params as Record<string, string | undefined>)['groupId']),
        uuidParam(req.params['settlementId']),
        uuidParam(req.params['transferId']),
        req.requestId,
      ),
    );
  });
  return router;
}
