import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody } from '../../shared/validation.js';
import {
  createPersonalCategorySchema,
  updatePersonalCategorySchema,
  type CreatePersonalCategoryInput,
  type UpdatePersonalCategoryInput,
} from './categories.schema.js';
import type { PersonalCategoriesService } from './categories.service.js';

export function createPersonalCategoriesRouter(
  service: PersonalCategoriesService,
  mutationLimit?: RequestHandler,
): Router {
  const router = Router();
  const limit = mutationLimit ?? ((_req, _res, next) => next());
  router.get('/', async (req, res) => sendData(res, await service.list(req.auth!.userId)));
  router.post('/', limit, validateBody(createPersonalCategorySchema), async (req, res) =>
    sendData(
      res,
      await service.create(req.auth!.userId, req.body as CreatePersonalCategoryInput),
      201,
    ),
  );
  router.patch(
    '/:categoryId',
    limit,
    validateBody(updatePersonalCategorySchema),
    async (req, res) =>
      sendData(
        res,
        await service.update(
          req.auth!.userId,
          uuidParam(req.params['categoryId']),
          req.body as UpdatePersonalCategoryInput,
        ),
      ),
  );
  router.delete('/:categoryId', limit, async (req, res) => {
    await service.delete(req.auth!.userId, uuidParam(req.params['categoryId']));
    sendData(res, { deleted: true });
  });
  return router;
}
