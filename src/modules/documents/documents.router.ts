import express, { Router, type RequestHandler } from 'express';
import type { DocumentAccessLevel } from '@prisma/client';
import { sendData } from '../../http/response.js';
import { AppError } from '../../shared/errors.js';
import { uuidParam, validateBody, validateQuery } from '../../shared/validation.js';
import {
  ALLOWED_DOCUMENT_TYPES,
  type LocalFileStorageProvider,
} from '../../infrastructure/storage.js';
import {
  grantSchema,
  listDocumentsQuerySchema,
  updateDocumentSchema,
  uploadQuerySchema,
  type ListDocumentsQuery,
  type UpdateDocumentInput,
  type UploadQuery,
} from './documents.schema.js';
import { contentDisposition, type DocumentsService } from './documents.service.js';

/** Biblioteca de documentos; la subida recibe el binario crudo con su Content-Type. */
export function createDocumentsRouter(
  service: DocumentsService,
  options: { maxBytes: number; uploadLimit?: RequestHandler },
): Router {
  const router = Router();
  const raw = express.raw({ type: Object.keys(ALLOWED_DOCUMENT_TYPES), limit: options.maxBytes });
  const uploadLimit: RequestHandler = options.uploadLimit ?? ((_req, _res, next) => next());

  router.post('/', uploadLimit, validateQuery(uploadQuerySchema), raw, async (req, res) => {
    const mimeType = (req.header('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    if (!ALLOWED_DOCUMENT_TYPES[mimeType]) {
      throw new AppError(415, 'UNSUPPORTED_MEDIA_TYPE', 'Solo se admiten PDF, JPEG, PNG o WebP');
    }
    sendData(
      res,
      await service.upload(
        req.auth!.userId,
        req.validatedQuery as UploadQuery,
        mimeType,
        req.body,
        req.requestId,
      ),
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
    sendData(
      res,
      await service.update(
        req.auth!.userId,
        uuidParam(req.params['documentId']),
        req.body as UpdateDocumentInput,
        req.requestId,
      ),
    );
  });
  router.delete('/:documentId', async (req, res) => {
    await service.remove(req.auth!.userId, uuidParam(req.params['documentId']), req.requestId);
    sendData(res, { deleted: true });
  });
  router.post('/:documentId/download-url', async (req, res) => {
    sendData(
      res,
      await service.downloadUrl(
        req.auth!.userId,
        uuidParam(req.params['documentId']),
        req.requestId,
      ),
    );
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
        req.requestId,
      ),
    );
  });
  router.delete('/:documentId/grants/:userId', async (req, res) => {
    await service.revoke(
      req.auth!.userId,
      uuidParam(req.params['documentId']),
      uuidParam(req.params['userId']),
      req.requestId,
    );
    sendData(res, { deleted: true });
  });
  router.get('/:documentId/access-logs', async (req, res) => {
    sendData(res, await service.logs(req.auth!.userId, uuidParam(req.params['documentId'])));
  });
  return router;
}

/** Descarga pública por capacidad: la URL firmada y de corta vida es la autorización. */
export function createLocalStorageRouter(
  storage: LocalFileStorageProvider,
  service: DocumentsService,
): Router {
  const router = Router();
  router.get('/local/:token', async (req, res) => {
    const claims = storage.verify(String(req.params['token'] ?? ''));
    if (!claims)
      throw new AppError(403, 'SIGNED_URL_INVALID', 'El enlace de descarga no es valido o expiro');
    const bytes = await service.readBytes(claims.key);
    res.setHeader('Content-Type', claims.mimeType);
    res.setHeader('Content-Length', String(bytes.length));
    res.setHeader('Content-Disposition', contentDisposition(claims.fileName));
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    res.status(200).end(bytes);
  });
  return router;
}
