import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from './errorHandler.js';

// Middleware que valida que el evento exista y no esté CERRADO.
// Adjunta el evento a req.evento para uso posterior.
export const requireEventoAbierto = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    const { id } = req.params;
    const eventoId = typeof id === 'string' && id.length > 0 ? id : null;
    if (!eventoId) {
      throw new HttpError(400, 'Falta el id del evento');
    }

    const evento = await prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }
    if (evento.estado === 'CERRADO') {
      throw new HttpError(409, 'No puedes modificar una cuenta cerrada');
    }

    // Adjuntamos el evento a la request para que el controller no tenga que buscarlo de nuevo
    (req as any).evento = evento;
    next();
  } catch (error) {
    next(error);
  }
};