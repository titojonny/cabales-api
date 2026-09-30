import { Router, type RequestHandler } from 'express';
import type { InvitationStatus } from '@prisma/client';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import {
  acceptInvitationSchema,
  createCategorySchema,
  createGroupSchema,
  invitationListQuerySchema,
  inviteSchema,
  updateGroupSchema,
  type CreateCategoryInput,
  type CreateGroupInput,
  type InviteInput,
  type UpdateGroupInput,
} from './groups.schema.js';
import type { GroupsService } from './groups.service.js';

/** CRUD de grupos, invitaciones y categorías; autenticación y CSRF se montan sobre el router. */
export function createGroupsRouter(
  service: GroupsService,
  limits: { invitations?: RequestHandler } = {},
): Router {
  const router = Router();
  const invitationLimit: RequestHandler = limits.invitations ?? ((_req, _res, next) => next());

  router.post('/', validateBody(createGroupSchema), async (req, res) => {
    sendData(res, await service.create(req.auth!.userId, req.body as CreateGroupInput), 201);
  });
  router.get('/', async (req, res) => sendData(res, await service.list(req.auth!.userId)));

  // Rutas literales antes de /:groupId para que no se interpreten como identificador.
  router.post('/invitations/preview', validateBody(acceptInvitationSchema), async (req, res) => {
    sendData(res, await service.previewInvitation(req.auth!.user.email, req.body.token as string));
  });
  router.post('/invitations/accept', validateBody(acceptInvitationSchema), async (req, res) => {
    sendData(
      res,
      await service.accept(
        req.auth!.userId,
        req.auth!.user.email,
        req.body.token as string,
        req.requestId,
      ),
    );
  });

  router.get('/:groupId', async (req, res) => {
    sendData(res, await service.detail(req.auth!.userId, uuidParam(req.params['groupId'])));
  });
  router.patch('/:groupId', validateBody(updateGroupSchema), async (req, res) => {
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam(req.params['groupId']),
        req.body as UpdateGroupInput,
      ),
    );
  });
  router.delete('/:groupId', async (req, res) => {
    await service.delete(req.auth!.userId, uuidParam(req.params['groupId']));
    sendData(res, { deleted: true });
  });

  router.get(
    '/:groupId/invitations',
    validateQuery(invitationListQuerySchema),
    async (req, res) => {
      const { status } = req.validatedQuery as { status?: InvitationStatus };
      sendData(
        res,
        await service.listInvitations(req.auth!.userId, uuidParam(req.params['groupId']), status),
      );
    },
  );
  router.post(
    '/:groupId/invitations',
    invitationLimit,
    validateBody(inviteSchema),
    async (req, res) => {
      sendData(
        res,
        await service.invite(
          req.auth!.userId,
          uuidParam(req.params['groupId']),
          req.body as InviteInput,
          req.requestId,
        ),
        201,
      );
    },
  );
  router.post('/:groupId/invitations/:invitationId/resend', invitationLimit, async (req, res) => {
    sendData(
      res,
      await service.resendInvitation(
        req.auth!.userId,
        uuidParam(req.params['groupId']),
        uuidParam(req.params['invitationId']),
        req.requestId,
      ),
    );
  });
  router.post('/:groupId/invitations/:invitationId/revoke', async (req, res) => {
    sendData(
      res,
      await service.revokeInvitation(
        req.auth!.userId,
        uuidParam(req.params['groupId']),
        uuidParam(req.params['invitationId']),
        req.requestId,
      ),
    );
  });

  router.get('/:groupId/categories', async (req, res) => {
    sendData(res, await service.listCategories(req.auth!.userId, uuidParam(req.params['groupId'])));
  });
  router.post('/:groupId/categories', validateBody(createCategorySchema), async (req, res) => {
    sendData(
      res,
      await service.createCategory(
        req.auth!.userId,
        uuidParam(req.params['groupId']),
        req.body as CreateCategoryInput,
      ),
      201,
    );
  });
  router.delete('/:groupId/categories/:categoryId', async (req, res) => {
    await service.deleteCategory(
      req.auth!.userId,
      uuidParam(req.params['groupId']),
      uuidParam(req.params['categoryId']),
    );
    sendData(res, { deleted: true });
  });
  return router;
}
