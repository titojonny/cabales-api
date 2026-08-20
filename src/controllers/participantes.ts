import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { agregarParticipanteSchema } from '../validators/participantes.js';

type CuerpoParticipante = z.infer<typeof agregarParticipanteSchema>;

// Agregar un comensal a la mesa (usuario registrado o invitado fantasma)
export const agregarParticipante = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: rutaId } = req.params;
    const { usuario_id, nombre_invitado } = req.body as CuerpoParticipante;

    if (typeof rutaId !== 'string' || rutaId.length === 0) {
      throw new HttpError(400, 'Falta el id del evento');
    }
    const evento_id = rutaId;

    // 1. El evento debe existir y no estar cerrado
    const evento = await prisma.evento.findUnique({ where: { id: evento_id } });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }
    if (evento.estado === 'CERRADO') {
      throw new HttpError(409, 'No puedes agregar personas a una cuenta cerrada');
    }

    // 2. Evitar que el mismo usuario registrado se siente dos veces
    // (la garantía real la da el índice único @@unique([evento_id, usuario_id]))
    if (usuario_id) {
      const existe = await prisma.participante.findFirst({
        where: { evento_id, usuario_id }
      });
      if (existe) {
        throw new HttpError(409, 'Este usuario ya está en la mesa');
      }
    }

    // 3. Sentar al comensal en la tabla pivote
    const nuevoParticipante = await prisma.participante.create({
      data: {
        evento_id,
        usuario_id: usuario_id ?? null,
        nombre_invitado: nombre_invitado ?? null
      }
    });

    res.status(201).json({
      success: true,
      message: nombre_invitado ? 'Invitado fantasma agregado' : 'Usuario agregado a la mesa',
      data: nuevoParticipante
    });
  } catch (error) {
    next(error);
  }
};