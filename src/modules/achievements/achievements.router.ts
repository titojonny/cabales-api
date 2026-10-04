import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { validateBody } from '../../shared/validation.js';
import { z } from 'zod';
import type { AchievementsService } from './achievements.service.js';

const rankingPrivacySchema = z.object({ rankingVisible: z.boolean() }).strict();

/** Catálogo con progreso real e historial de logros del usuario. */
export function createAchievementsRouter(service: AchievementsService): Router {
  const router = Router();
  router.get('/', async (req, res) => sendData(res, await service.evaluate(req.auth!.userId)));
  router.get('/history', async (req, res) =>
    sendData(res, await service.history(req.auth!.userId)),
  );
  router.get('/privacy', async (req, res) =>
    sendData(res, await service.rankingPrivacy(req.auth!.userId)),
  );
  router.put('/privacy', validateBody(rankingPrivacySchema), async (req, res) =>
    sendData(res, await service.updateRankingPrivacy(req.auth!.userId, req.body.rankingVisible)),
  );
  return router;
}
