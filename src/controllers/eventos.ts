import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { Prisma } from '@prisma/client';
import { crearEventoSchema } from '../validators/schemas.js';

type CuerpoEvento = z.infer<typeof crearEventoSchema>;

// Crear un evento nuevo
export const crearEvento = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parse = crearEventoSchema.safeParse(req.body);

    if (!parse.success) {
      res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        error: parse.error.issues.map((issue) => issue.message)
      });
      return;
    }

    const { nombre, creador_id } = parse.data;

    const creador = await prisma.usuario.findUnique({ where: { id: creador_id } });
    if (!creador) {
      throw new HttpError(404, 'El usuario creador no existe');
    }

    const nuevoEvento = await prisma.evento.create({
      data: { nombre, creador_id }
    });

    res.status(201).json({ success: true, message: '¡Salida creada!', data: nuevoEvento });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ success: false, message: 'Ya existe un evento con ese nombre' });
      return;
    }
    next(error);
  }
};

// Radiografía de la mesa: detalle completo de un evento.
// Los participantes vienen ordenados por consumo DESC (vista "quién consumió más").
export const obtenerEventoDetalle = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: eventoId } = req.params;

    if (typeof eventoId !== 'string' || eventoId.length === 0) {
      throw new HttpError(400, 'Falta el id del evento');
    }

    const evento = await prisma.evento.findUnique({
      where: { id: eventoId },
      include: {
        creador: { select: { id: true, nombre: true, avatar_url: true } },
        participantes: {
          orderBy: { monto_consumido_centavos: 'desc' },
          include: { usuario: { select: { id: true, nombre: true, avatar_url: true } } }
        },
        _count: { select: { participantes: true, transacciones: true } }
      }
    });

    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }

    const data = {
      id: evento.id,
      nombre: evento.nombre,
      fecha: evento.fecha,
      estado: evento.estado,
      total_gastado_centavos: evento.total_gastado_centavos,
      numero_comensales: evento._count.participantes,
      numero_transacciones: evento._count.transacciones,
      creador: evento.creador,
      participantes: evento.participantes.map((participante) => ({
        id: participante.id,
        nombre_visible: participante.usuario?.nombre ?? participante.nombre_invitado,
        es_fantasma: !participante.usuario,
        usuario_id: participante.usuario_id,
        monto_consumido_centavos: participante.monto_consumido_centavos,
        monto_pagado_centavos: participante.monto_pagado_centavos
      }))
    };

    res.status(200).json({ success: true, message: 'Evento obtenido', data });
  } catch (error) {
    next(error);
  }
};
