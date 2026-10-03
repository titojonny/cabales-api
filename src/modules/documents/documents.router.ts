import express, { Router, type RequestHandler } from 'express';
import { pipeline } from 'node:stream/promises';
import type { DocumentAccessLevel } from '@prisma/client';
import { sendData } from '../../http/response.js';
import { AppError } from '../../shared/errors.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import { ALLOWED_DOCUMENT_TYPES } from '../../infrastructure/storage.js';
import type { DocumentLockService } from './document-lock.service.js';
import {
  documentLockPinSchema,
  documentLockRemoveSchema,
  documentLockSettingsSchema,
  grantSchema,
  listDocumentsQuerySchema,
  sharedLinkSchema,
  updateDocumentSchema,
  uploadQuerySchema,
  webAuthnResponseSchema,
  type ListDocumentsQuery,
  type UpdateDocumentInput,
  type UploadQuery,
} from './documents.schema.js';
import { contentDisposition, type DocumentsService } from './documents.service.js';

type Limit = RequestHandler;

/** Rutas privadas de la biblioteca y del bloqueo de Docs. */
export function createDocumentsRouter(
  service: DocumentsService,
  options: {
    maxBytes: number;
    uploadLimit?: Limit;
    downloadUrlLimit?: Limit;
    pinLimit?: Limit;
    lock?: DocumentLockService;
  },
): Router {
  const router = Router();
  const raw = express.raw({ type: Object.keys(ALLOWED_DOCUMENT_TYPES), limit: options.maxBytes });
  const uploadLimit = options.uploadLimit ?? ((_req, _res, next) => next());
  const downloadUrlLimit = options.downloadUrlLimit ?? ((_req, _res, next) => next());
  const pinLimit = options.pinLimit ?? ((_req, _res, next) => next());

  if (options.lock) {
    router.get('/lock/status', async (req, res) =>
      sendData(res, await options.lock!.status(req.auth!.userId, req.auth!.sessionId)),
    );
    router.put('/lock', validateBody(documentLockSettingsSchema), async (req, res) => {
      sendData(res, await options.lock!.configure(req.auth!.userId, req.body));
    });
    router.delete('/lock', validateBody(documentLockRemoveSchema), async (req, res) => {
      sendData(res, await options.lock!.remove(req.auth!.userId, req.body.password));
    });
    router.post('/lock/pin', pinLimit, validateBody(documentLockPinSchema), async (req, res) => {
      sendData(res, await options.lock!.unlockPin(req.auth!.userId, req.auth!.sessionId, req.body.pin));
    });
    router.post('/lock/webauthn/registration-options', pinLimit, validateBody(documentLockRemoveSchema), async (req, res) => {
      sendData(res, await options.lock!.registrationOptions(req.auth!.userId, req.body.password));
    });
    router.post('/lock/webauthn/registration-verify', pinLimit, validateBody(webAuthnResponseSchema), async (req, res) => {
      sendData(res, await options.lock!.verifyRegistration(req.auth!.userId, req.body));
    });
    router.post('/lock/webauthn/authentication-options', pinLimit, async (req, res) => {
      sendData(res, await options.lock!.authenticationOptions(req.auth!.userId));
    });
    router.post('/lock/webauthn/authentication-verify', pinLimit, validateBody(webAuthnResponseSchema), async (req, res) => {
      sendData(res, await options.lock!.verifyAuthentication(req.auth!.userId, req.auth!.sessionId, req.body));
    });
    router.use(async (req, _res, next) => {
      await options.lock!.requireUnlocked(req.auth!.userId, req.auth!.sessionId);
      next();
    });
  }

  router.post('/', uploadLimit, validateQuery(uploadQuerySchema), raw, async (req, res) => {
    const mimeType = (req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_DOCUMENT_TYPES[mimeType])
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Solo se admiten PDF, JPEG, PNG o WebP');
    sendData(
      res,
      await service.upload(req.auth!.userId, req.validatedQuery as UploadQuery, mimeType, req.body, req.requestId),
      201,
    );
  });
  router.get('/', validateQuery(listDocumentsQuerySchema), async (req, res) => {
    const result = await service.list(req.auth!.userId, req.validatedQuery as ListDocumentsQuery);
    sendData(res, result.items, 200, { nextCursor: result.nextCursor });
  });
  router.get('/:documentId', async (req, res) => {
    sendData(res, await service.detail(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  router.patch('/:documentId', validateBody(updateDocumentSchema), async (req, res) => {
    sendData(res, await service.update(req.auth!.userId, uuidParam(req.params['documentId']), req.body as UpdateDocumentInput, req.requestId));
  });
  router.delete('/:documentId', async (req, res) => {
    await service.remove(req.auth!.userId, uuidParam(req.params['documentId']), req.requestId);
    sendData(res, { deleted: true });
  });
  router.get('/:documentId/download', downloadUrlLimit, async (req, res) => {
    const result = await service.downloadStream(req.auth!.userId, uuidParam(req.params['documentId']), req.requestId);
    res.setHeader('Content-Type', result.document.mimeType);
    res.setHeader('Content-Length', String(result.document.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(result.document.name));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    try {
      await pipeline(result.stream, res);
    } catch (error) {
      if (!res.headersSent) throw error;
      res.destroy();
    }
  });
  // Compatibilidad: la URL devuelta apunta a la API autenticada, nunca a S3.
  router.post('/:documentId/download-url', downloadUrlLimit, async (req, res) => {
    sendData(res, await service.downloadUrl(req.auth!.userId, uuidParam(req.params['documentId']), req.requestId));
  });
  router.post('/:documentId/pin', async (req, res) => {
    sendData(res, await service.pin(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  router.delete('/:documentId/pin', async (req, res) => {
    sendData(res, await service.unpin(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  router.get('/:documentId/grants', async (req, res) => {
    sendData(res, await service.listGrants(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  router.put('/:documentId/grants/:userId', validateBody(grantSchema), async (req, res) => {
    sendData(
      res,
      await service.grant(
        req.auth!.userId,
        uuidParam(req.params['documentId']),
        uuidParam(req.params['userId']),
        req.body.access as DocumentAccessLevel,
        req.body.expiresAt ? new Date(req.body.expiresAt) : req.body.expiresAt,
        req.requestId,
      ),
    );
  });
  router.delete('/:documentId/grants/:userId', async (req, res) => {
    await service.revoke(req.auth!.userId, uuidParam(req.params['documentId']), uuidParam(req.params['userId']), req.requestId);
    sendData(res, { deleted: true });
  });
  router.get('/:documentId/shared-links', async (req, res) => {
    sendData(res, await service.sharedLinks(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  router.post('/:documentId/shared-links', validateBody(sharedLinkSchema), async (req, res) => {
    sendData(res, await service.createSharedLink(req.auth!.userId, uuidParam(req.params['documentId']), req.body), 201);
  });
  router.post('/:documentId/shared-links/:linkId/revoke', async (req, res) => {
    sendData(res, await service.revokeSharedLink(req.auth!.userId, uuidParam(req.params['documentId']), uuidParam(req.params['linkId'])));
  });
  router.get('/:documentId/access-logs', async (req, res) => {
    sendData(res, await service.logs(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  return router;
}
