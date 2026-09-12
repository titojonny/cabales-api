import { NextFunction, Request, RequestHandler, Response } from 'express';
import { HttpError } from './errorHandler.js';

// Valida que un parámetro de ruta sea un string no vacío
export function validarId(id: string | string[] | undefined, recurso = 'recurso'): string {
  const valor = Array.isArray(id) ? id[0] : id;
  if (typeof valor !== 'string' || valor.length === 0) {
    throw new HttpError(400, `Falta el id del ${recurso}`);
  }
  return valor;
}

// 1. Como middleware factory: assertParamId('evento') -> RequestHandler
export function assertParamId(recurso?: string, paramName?: string): RequestHandler;
// 2. Como función de aserción: assertParamId(req.params.id, 'evento') -> string
export function assertParamId(id: string | string[] | undefined, recurso?: string): string;
// 3. Como middleware directo: router.get('/...', assertParamId, handler)
export function assertParamId(req: Request, res: Response, next: NextFunction): void;

// Implementación polimórfica que soporta los tres usos
export function assertParamId(
  arg1?: Request | string | string[],
  arg2?: Response | string,
  arg3?: NextFunction
): any {
  // Caso 3: Invocado directamente como middleware Express (req, res, next)
  if (arg1 && typeof arg1 === 'object' && 'params' in arg1 && typeof arg3 === 'function') {
    const req = arg1 as Request;
    const next = arg3 as NextFunction;
    validarId(req.params.id, 'recurso');
    return next();
  }

  // Caso 2: Invocado como función helper con 2 argumentos -> assertParamId(id, 'evento')
  if (typeof arg2 === 'string') {
    return validarId(arg1 as string | string[] | undefined, arg2);
  }

  // Caso 2b: Si arg1 es undefined o array, es llamada de aserción -> assertParamId(undefined)
  if (arg1 === undefined || Array.isArray(arg1)) {
    return validarId(arg1, 'recurso');
  }

  // Caso 1: Invocado como middleware factory -> assertParamId('evento')
  const recurso = typeof arg1 === 'string' ? arg1 : 'recurso';
  return (req: Request, res: Response, next: NextFunction): void => {
    validarId(req.params.id, recurso);
    next();
  };
}