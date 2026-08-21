import { Router } from 'express';
import { sendData } from '../../http/response.js';
import { uuidParam, validateBody } from '../../shared/validation.js';
import {
  acceptInvitationSchema,
  createGroupSchema,
  inviteSchema,
  updateGroupSchema,
  type CreateGroupInput,
  type InviteInput,
  type UpdateGroupInput,
} from './groups.schema.js';
import type { GroupsService } from './groups.service.js';

/** CRUD de grupos e invitaciones; la autenticación y CSRF se montan sobre el router. */
export function createGroupsRouter(service: GroupsService): Router {
  const router = Router();
  router.post('/', validateBody(createGroupSchema), async (req, res) => {
    sendData(res, await service.create(req.auth!.userId, req.body as CreateGroupInput), 201);
  });
  router.get('/', async (req, res) => sendData(res, await service.list(req.auth!.userId)));
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
  router.post('/:groupId/invitations', validateBody(inviteSchema), async (req, res) => {
    sendData(
      res,
      await service.invite(
        req.auth!.userId,
        uuidParam(req.params['groupId']),
        req.body as InviteInput,
      ),
      201,
    );
  });
  router.post('/invitations/accept', validateBody(acceptInvitationSchema), async (req, res) => {
    sendData(
      res,
      await service.accept(req.auth!.userId, req.auth!.user.email, req.body.token as string),
    );
  });
  return router;
}
