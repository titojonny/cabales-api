import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { groupParam, uuidParam, validateBody } from '../../shared/validation.js';
import {
  createTagSchema,
  updateTagSchema,
  type CreateTagInput,
  type UpdateTagInput,
} from './tags.schema.js';
import type { TagsService } from './tags.service.js';

export function createPersonalTagsRouter(
  service: TagsService,
  mutationLimit?: RequestHandler,
): Router {
  const router = Router();
  const limit = mutationLimit ?? ((_req, _res, next) => next());
  router.get('/', async (req, res) => sendData(res, await service.listPersonal(req.auth!.userId)));
  router.post('/', limit, validateBody(createTagSchema), async (req, res) =>
    sendData(res, await service.createPersonal(req.auth!.userId, req.body as CreateTagInput), 201),
  );
  router.patch('/:tagId', limit, validateBody(updateTagSchema), async (req, res) =>
    sendData(
      res,
      await service.updatePersonal(
        req.auth!.userId,
        uuidParam(req.params['tagId']),
        req.body as UpdateTagInput,
      ),
    ),
  );
  router.delete('/:tagId', limit, async (req, res) => {
    await service.deletePersonal(req.auth!.userId, uuidParam(req.params['tagId']));
    sendData(res, { deleted: true });
  });
  return router;
}

export function createGroupTagsRouter(
  service: TagsService,
  mutationLimit?: RequestHandler,
): Router {
  const router = Router({ mergeParams: true });
  const limit = mutationLimit ?? ((_req, _res, next) => next());
  router.get('/', async (req, res) =>
    sendData(res, await service.listGroup(req.auth!.userId, groupParam(req))),
  );
  router.post('/', limit, validateBody(createTagSchema), async (req, res) =>
    sendData(
      res,
      await service.createGroup(req.auth!.userId, groupParam(req), req.body as CreateTagInput),
      201,
    ),
  );
  router.patch('/:tagId', limit, validateBody(updateTagSchema), async (req, res) =>
    sendData(
      res,
      await service.updateGroup(
        req.auth!.userId,
        groupParam(req),
        uuidParam(req.params['tagId']),
        req.body as UpdateTagInput,
      ),
    ),
  );
  router.delete('/:tagId', limit, async (req, res) => {
    await service.deleteGroup(req.auth!.userId, groupParam(req), uuidParam(req.params['tagId']));
    sendData(res, { deleted: true });
  });
  return router;
}
