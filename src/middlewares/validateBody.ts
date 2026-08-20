import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';

// Valida el req.body contra un schema de zod.
// Si pasa, deja el cuerpo ya parseado/tipado en req.body para el controlador.
export function validateBody<T extends z.ZodTypeAny>(schema: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const parse = schema.safeParse(req.body);

    if (!parse.success) {
      res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        error: parse.error.issues.map((issue) => issue.message)
      });
      return;
    }

    req.body = parse.data;
    next();
  };
}