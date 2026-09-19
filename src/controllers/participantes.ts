import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { agregarParticipanteSchema } from '../validators/participantes.js';

type CuerpoParticipante = z.infer<typeof agregarParticipanteSchema>;

// Agregar un comensal a la mesa (usuario registrado o invitado fantasma)
export const agregarParticipante = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const evento_id = req.evento!.id;
    const { usuario_id, nombre_invitado } = req.body as CuerpoParticipante;

    // 1. Evitar que el mismo usuario registrado se siente dos veces
    // (la garantía real la da el índice único @@unique([evento_id, usuario_id]))
    if (usuario_id) {
      const existe = await prisma.participante.findFirst({
        where: { evento_id, usuario_id }
      });
      if (existe) {
        throw new HttpError(409, 'Este usuario ya está en la mesa');
      }
    }

    // 2. Sentar al comensal en la tabla pivote
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

// PATCH /api/events/:id/participants/:participantId/claim
export const reclamarParticipante = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const eventoId = req.evento!.id;
    const { usuario_id } = req.body as { usuario_id: string };
    const participanteId = assertParamId(req.params.participantId, 'participante');

    // 1. Verificar que el usuario exista
    const usuario = await prisma.usuario.findUnique({
      where: { id: usuario_id }
    });
    if (!usuario) {
      throw new HttpError(404, 'El usuario que intenta reclamar el lugar no existe');
    }

    // 2. Verificar que el participante exista y pertenezca al evento
    const participante = await prisma.participante.findFirst({
      where: { id: participanteId, evento_id: eventoId },
      include: { usuario: { select: { id: true, nombre: true, avatar_url: true } } }
    });

    if (!participante) {
      throw new HttpError(404, 'El comensal no existe en esta mesa');
    }

    // Si ya está asignado al mismo usuario, es idempotente
    if (participante.usuario_id === usuario_id) {
      res.status(200).json({
        success: true,
        message: 'Este lugar ya está asignado a tu usuario',
        data: participante
      });
      return;
    }

    // Si ya está asignado a otro usuario registrado
    if (participante.usuario_id && participante.usuario_id !== usuario_id) {
      throw new HttpError(409, 'Este lugar ya ha sido reclamado por otro usuario registrado');
    }

    // 3. Evitar que el usuario ya tenga otro asiento en esta misma mesa
    const yaEstaEnMesa = await prisma.participante.findFirst({
      where: { evento_id: eventoId, usuario_id }
    });
    if (yaEstaEnMesa) {
      throw new HttpError(409, 'Ya tienes otro lugar asignado en esta mesa');
    }

    // 4. Vincular el participante al usuario
    const actualizado = await prisma.participante.update({
      where: { id: participanteId },
      data: {
        usuario_id
      },
      include: {
        usuario: {
          select: { id: true, nombre: true, avatar_url: true }
        }
      }
    });

    res.status(200).json({
      success: true,
      message: '¡Lugar reclamado exitosamente!',
      data: actualizado
    });
  } catch (error) {
    next(error);
  }
};