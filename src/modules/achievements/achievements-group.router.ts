import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { groupParam } from '../../shared/validation.js';
import type { AchievementsService } from './achievements.service.js';

/** Insignias y ranking aislados por la frontera de membresia del grupo. */
export function createGroupAchievementsRouter(service: AchievementsService): Router {
  const router = Router({ mergeParams: true });
  router.get('/ranking', async (req, res) => {
    const result = await service.ranking(req.auth!.userId, groupParam(req));
    if (!result)
      return res.status(404).json({
        success: false,
        error: {
          code: 'GROUP_NOT_FOUND',
          message: 'Grupo no encontrado',
          requestId: req.requestId,
        },
      });
    sendData(res, result);
  });
  router.get('/members', async (req, res) => {
    const result = await service.members(req.auth!.userId, groupParam(req));
    if (!result)
      return res.status(404).json({
        success: false,
        error: {
          code: 'GROUP_NOT_FOUND',
          message: 'Grupo no encontrado',
          requestId: req.requestId,
        },
      });
    sendData(res, result);
  });
  return router;
}
