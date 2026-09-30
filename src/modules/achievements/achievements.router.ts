import { Router } from 'express';
import { sendData } from '../../http/response.js';
import type { AchievementsService } from './achievements.service.js';

/** Catálogo con progreso real e historial de logros del usuario. */
export function createAchievementsRouter(service: AchievementsService): Router {
  const router = Router();
  router.get('/', async (req, res) => sendData(res, await service.evaluate(req.auth!.userId)));
  router.get('/history', async (req, res) =>
    sendData(res, await service.history(req.auth!.userId)),
  );
  return router;
}
