import { randomUUID, timingSafeEqual } from 'node:crypto';
import type { ErrorRequestHandler, NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import type { AppLogger } from '../config/logger.js';
import type { AuthPort } from '../modules/auth/auth.service.js';
import { hashToken } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';

/** Propaga un identificador acotado o genera uno nuevo para toda solicitud. */
export function requestContext(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header('X-Request-Id');
  req.requestId = incoming && /^[A-Za-z0-9._:-]{1,100}$/.test(incoming) ? incoming : randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  next();
}

/** Impide almacenar respuestas que contienen identidad o datos privados. */
export function privateNoStore(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'private, no-store');
  next();
}

/** Recupera el token CSRF solo si la cookie coincide con la sesión autenticada. */
export function csrfTokenFromCookie(req: Request, cookieName: string): string {
  const token = req.cookies?.[`${cookieName}_csrf`] as string | undefined;
  const expected = req.auth?.csrfTokenHash;
  if (!token || !expected) {
    throw new AppError(403, 'CSRF_INVALID', 'Token CSRF ausente o invalido');
  }
  const actualHash = Buffer.from(hashToken(token));
  const expectedHash = Buffer.from(expected);
  if (actualHash.length !== expectedHash.length || !timingSafeEqual(actualHash, expectedHash)) {
    throw new AppError(403, 'CSRF_INVALID', 'Token CSRF ausente o invalido');
  }
  return token;
}

/** Resuelve una sesión opaca y falla cerrado ante cualquier token inválido. */
export function requireAuth(authService: AuthPort, cookieName: string) {
  return async (req: Request, _res: Response, next: NextFunction): Promise<void> => {
    try {
      const token = req.cookies?.[cookieName] as string | undefined;
      if (!token) throw new AppError(401, 'AUTH_REQUIRED', 'Autenticacion requerida');
      req.auth = await authService.authenticate(token);
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Exige token CSRF de cabecera, cookie legible y sesión; compara sus hashes en tiempo constante. */
export function requireCsrf(cookieName: string) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const header = req.header('X-CSRF-Token');
    if (!header) {
      next(new AppError(403, 'CSRF_INVALID', 'Token CSRF ausente o invalido'));
      return;
    }
    try {
      const cookie = csrfTokenFromCookie(req, cookieName);
      const headerHash = Buffer.from(hashToken(header));
      const cookieHash = Buffer.from(hashToken(cookie));
      if (headerHash.length !== cookieHash.length || !timingSafeEqual(headerHash, cookieHash)) {
        throw new AppError(403, 'CSRF_INVALID', 'Token CSRF ausente o invalido');
      }
      next();
    } catch (error) {
      next(error);
    }
  };
}

/** Convierte rutas desconocidas al mismo contrato de error. */
export function notFound(req: Request, _res: Response, next: NextFunction): void {
  next(new AppError(404, 'NOT_FOUND', `Ruta no encontrada: ${req.method} ${req.path}`));
}

/** Centraliza errores, registra contexto mínimo y evita filtrar detalles internos. */
export function errorHandler(logger: AppLogger): ErrorRequestHandler {
  return (error: unknown, req: Request, res: Response, _next: NextFunction): void => {
    const parserError = error as { type?: string; status?: number };
    const controlled =
      error instanceof AppError
        ? error
        : error instanceof ZodError
          ? new AppError(400, 'VALIDATION_ERROR', 'Entrada invalida', error.issues)
          : parserError.type === 'entity.too.large' || parserError.status === 413
            ? new AppError(413, 'PAYLOAD_TOO_LARGE', 'El cuerpo excede el limite permitido')
            : parserError.type === 'entity.parse.failed' || parserError.status === 400
              ? new AppError(400, 'INVALID_JSON', 'El cuerpo JSON no es valido')
              : new AppError(500, 'INTERNAL_ERROR', 'Error interno controlado');

    const log = controlled.status >= 500 ? logger.error.bind(logger) : logger.warn.bind(logger);
    log(
      { requestId: req.requestId, code: controlled.code, status: controlled.status },
      controlled.message,
    );
    res.status(controlled.status).json({
      success: false,
      error: {
        code: controlled.code,
        message: controlled.message,
        requestId: req.requestId,
        ...(controlled.details && controlled.status < 500 ? { details: controlled.details } : {}),
      },
    });
  };
}
