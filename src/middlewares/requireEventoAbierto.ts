import { NextFunction, Request, Response } from 'express';
import { Evento } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { HttpError } from './errorHandler.js';
import { assertParamId } from './assertParamId.js';

declare global {
  namespace Express {
    interface Request {
      evento?: Evento;
    }
  }
}

// Middleware que valida que el evento exista y no esté CERRADO.
// Adjunta el evento a req.evento para uso posterior.
export const requireEventoAbierto = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const eventoId = assertParamId(req.params.id, 'evento');

    const evento = await prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }
    if (evento.estado === 'CERRADO') {
      throw new HttpError(409, 'No puedes modificar una cuenta cerrada');
    }

    // Adjuntamos el evento a la request para que el controller no tenga que buscarlo de nuevo
    req.evento = evento;
    next();
  } catch (error) {
    next(error);
  }
};