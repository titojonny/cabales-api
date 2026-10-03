import type { NextFunction, Request, Response } from 'express';
import type { ZodType } from 'zod';
import { AppError } from './errors.js';

/** Valida y reemplaza el body por su representación canónica. */
export function validateBody(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body);
    if (!result.success) {
      next(new AppError(400, 'VALIDATION_ERROR', 'El cuerpo no es valido', result.error.issues));
      return;
    }
    req.body = result.data;
    next();
  };
}

/** Valida la query string (Express 5 la expone como solo lectura) y la deja en req.validatedQuery. */
export function validateQuery(schema: ZodType) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const raw: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(req.query)) {
      // Rechaza parámetros repetidos o anidados para evitar ambigüedad y contaminación.
      if (typeof value !== 'string') {
        next(new AppError(400, 'VALIDATION_ERROR', `El parametro ${key} no es valido`));
        return;
      }
      raw[key] = value;
    }
    const result = schema.safeParse(raw);
    if (!result.success) {
      next(
        new AppError(400, 'VALIDATION_ERROR', 'Los parametros no son validos', result.error.issues),
      );
      return;
    }
    req.validatedQuery = result.data;
    next();
  };
}

/** Lee un parámetro UUID ya validado en la frontera de ruta. */
export function uuidParam(value: string | string[] | undefined): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
  ) {
    throw new AppError(400, 'INVALID_ID', 'El identificador no es un UUID valido');
  }
  return value;
}

/** Lee el groupId heredado por routers anidados con mergeParams. */
export function groupParam(req: Request): string {
  return uuidParam((req.params as Record<string, string | undefined>)['groupId']);
}

/** Exige y acota la llave usada por mutaciones financieras. */
export function idempotencyHeader(req: Request): string {
  const value = req.header('Idempotency-Key');
  if (!value || value.length < 8 || value.length > 128 || !/^[\x21-\x7E]+$/.test(value)) {
    throw new AppError(
      400,
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key debe tener entre 8 y 128 caracteres ASCII',
    );
  }
  return value;
}
