import { Router } from 'express';
import type { FundRole } from '@prisma/client';
import { sendData } from '../../http/response.js';
import {
  groupParam,
  idempotencyHeader,
  uuidParam,
  validateBody,
  validateQuery,
} from '../../shared/validation.js';
import {
  addFundMemberSchema,
  contributionRequestsQuerySchema,
  createContributionRequestSchema,
  createFundSchema,
  createMovementSchema,
  movementsQuerySchema,
  updateFundMemberSchema,
  updateFundSchema,
  type CreateFundInput,
  type CreateContributionRequestInput,
  type CreateMovementInput,
  type ContributionRequestsQuery,
  type UpdateFundInput,
} from './funds.schema.js';
import type { FundsService } from './funds.service.js';

/** Fondos comunes anidados bajo el grupo. */
export function createFundsRouter(service: FundsService): Router {
  const router = Router({ mergeParams: true });
  const fund = (params: object) =>
    uuidParam((params as Record<string, string | undefined>)['fundId']);

  router.post('/', validateBody(createFundSchema), async (req, res) => {
    sendData(
      res,
      await service.create(
        req.auth!.userId,
        groupParam(req),
        req.body as CreateFundInput,
        req.requestId,
      ),
      201,
    );
  });
  router.get('/', async (req, res) =>
    sendData(res, await service.list(req.auth!.userId, groupParam(req))),
  );
  router.get('/:fundId', async (req, res) => {
    sendData(res, await service.detail(req.auth!.userId, groupParam(req), fund(req.params)));
  });
  router.patch('/:fundId', validateBody(updateFundSchema), async (req, res) => {
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        groupParam(req),
        fund(req.params),
        req.body as UpdateFundInput,
      ),
    );
  });
  router.post('/:fundId/archive', async (req, res) => {
    sendData(res, await service.archive(req.auth!.userId, groupParam(req), fund(req.params)));
  });
  router.post(
    '/:fundId/contribution-requests',
    validateBody(createContributionRequestSchema),
    async (req, res) => {
      sendData(
        res,
        await service.createContributionRequest(
          req.auth!.userId,
          groupParam(req),
          fund(req.params),
          req.body as CreateContributionRequestInput,
          req.requestId,
        ),
        201,
      );
    },
  );
  router.get(
    '/:fundId/contribution-requests',
    validateQuery(contributionRequestsQuerySchema),
    async (req, res) => {
      sendData(
        res,
        await service.contributionRequests(
          req.auth!.userId,
          groupParam(req),
          fund(req.params),
          req.validatedQuery as ContributionRequestsQuery,
        ),
      );
    },
  );
  router.post('/:fundId/members', validateBody(addFundMemberSchema), async (req, res) => {
    sendData(
      res,
      await service.addMember(
        req.auth!.userId,
        groupParam(req),
        fund(req.params),
        req.body.groupMemberId as string,
        req.body.role as FundRole,
      ),
      201,
    );
  });
  router.patch(
    '/:fundId/members/:memberId',
    validateBody(updateFundMemberSchema),
    async (req, res) => {
      sendData(
        res,
        await service.updateMember(
          req.auth!.userId,
          groupParam(req),
          fund(req.params),
          uuidParam(req.params['memberId']),
          req.body.role as FundRole,
        ),
      );
    },
  );
  router.delete('/:fundId/members/:memberId', async (req, res) => {
    await service.removeMember(
      req.auth!.userId,
      groupParam(req),
      fund(req.params),
      uuidParam(req.params['memberId']),
    );
    sendData(res, { deleted: true });
  });
  router.get('/:fundId/movements', validateQuery(movementsQuerySchema), async (req, res) => {
    const query = req.validatedQuery as { cursor?: string; limit: number };
    const result = await service.movements(
      req.auth!.userId,
      groupParam(req),
      fund(req.params),
      query.cursor,
      query.limit,
    );
    sendData(res, result.items, 200, { nextCursor: result.nextCursor });
  });
  router.post('/:fundId/movements', validateBody(createMovementSchema), async (req, res) => {
    const result = await service.createMovement(
      req.auth!.userId,
      groupParam(req),
      fund(req.params),
      req.body as CreateMovementInput,
      idempotencyHeader(req),
      req.requestId,
    );
    sendData(res, result.data, result.replayed ? 200 : 201, {
      idempotencyReplayed: result.replayed,
    });
  });
  return router;
}
