import { pipeline } from 'node:stream/promises';
import { Router, type RequestHandler } from 'express';
import { sendData } from '../../http/response.js';
import { AppError } from '../../shared/errors.js';
import { sharedTokenSchema } from './documents.schema.js';
import { contentDisposition, type DocumentsService } from './documents.service.js';

/** Enlace público de solo lectura: solo expone el nombre y la descarga. */
export function createPublicSharedDocumentsRouter(
  service: DocumentsService,
  limit?: RequestHandler,
): Router {
  const router = Router();
  const guarded = limit ?? ((_req, _res, next) => next());
  router.get('/:token', guarded, async (req, res) => {
    const parsed = sharedTokenSchema.safeParse(String(req.params['token'] ?? ''));
    if (!parsed.success)
      throw new AppError(404, 'SHARED_LINK_INVALID', 'El enlace no existe, caduco o fue revocado');
    sendData(res, await service.sharedPreview(parsed.data));
  });
  router.get('/:token/download', guarded, async (req, res) => {
    const parsed = sharedTokenSchema.safeParse(String(req.params['token'] ?? ''));
    if (!parsed.success)
      throw new AppError(404, 'SHARED_LINK_INVALID', 'El enlace no existe, caduco o fue revocado');
    const result = await service.sharedDownloadStream(parsed.data, req.requestId);
    res.setHeader('Content-Type', result.document.mimeType);
    res.setHeader('Content-Length', String(result.document.sizeBytes));
    res.setHeader('Content-Disposition', contentDisposition(result.document.name));
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    try {
      await pipeline(result.stream, res);
    } catch (error) {
      if (!res.headersSent) throw error;
      res.destroy();
    }
  });
  return router;
}
