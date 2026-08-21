import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { Prisma } from '@prisma/client';
import { crearUsuarioSchema } from '../validators/schemas.js';

type CuerpoUsuario = z.infer<typeof crearUsuarioSchema>;

// Crear un usuario nuevo
export const crearUsuario = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parse = crearUsuarioSchema.safeParse(req.body);

    if (!parse.success) {
      res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        error: parse.error.issues.map((issue) => issue.message)
      });
      return;
    }

    const { nombre, email } = parse.data;

    const nuevoUsuario = await prisma.usuario.create({
      data: { nombre, email }
    });

    res.status(201).json({ success: true, message: 'Usuario creado', data: nuevoUsuario });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ success: false, message: 'Ya existe un usuario con ese email' });
      return;
    }
    next(error);
  }
};

// Dashboard del usuario: sus salidas como creador o como invitado.
// El OR no duplica eventos: si es creador Y participante, sale una sola vez.
export const obtenerEventosDeUsuario = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: usuarioId } = req.params;

    if (typeof usuarioId !== 'string' || usuarioId.length === 0) {
      throw new HttpError(400, 'Falta el id del usuario');
    }

    const usuario = await prisma.usuario.findUnique({
      where: { id: usuarioId },
      select: { id: true }
    });
    if (!usuario) {
      throw new HttpError(404, 'El usuario no existe');
    }

    const eventos = await prisma.evento.findMany({
      where: {
        OR: [{ creador_id: usuarioId }, { participantes: { some: { usuario_id: usuarioId } } }]
      },
      select: {
        id: true,
        nombre: true,
        estado: true,
        fecha: true,
        total_gastado_centavos: true,
        _count: { select: { participantes: true } },
        creador: { select: { id: true, nombre: true } }
      },
      orderBy: { fecha: 'desc' }
    });

    const data = eventos.map((evento) => ({
      id: evento.id,
      nombre: evento.nombre,
      estado: evento.estado,
      fecha: evento.fecha,
      total_gastado_centavos: evento.total_gastado_centavos,
      numero_comensales: evento._count.participantes,
      es_creador: evento.creador.id === usuarioId,
      creador: evento.creador
    }));

    res.status(200).json({ success: true, message: 'Eventos obtenidos', data });
  } catch (error) {
    next(error);
  }
};
