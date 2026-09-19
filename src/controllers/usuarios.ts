import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { Prisma } from '@prisma/client';
import { crearUsuarioSchema } from '../validators/schemas.js';

type CuerpoUsuario = z.infer<typeof crearUsuarioSchema>;

// Crear un usuario nuevo
export const crearUsuario = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { nombre, email } = req.body as CuerpoUsuario;

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

// Listar todos los usuarios
export const listarUsuarios = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const usuarios = await prisma.usuario.findMany({
      orderBy: { fecha_registro: 'asc' }
    });
    res.json({ success: true, data: usuarios });
  } catch (error) {
    next(error);
  }
};

// Dashboard del usuario: sus salidas como creador o como invitado.
// El OR no duplica eventos: si es creador Y participante, sale una sola vez.
export const obtenerEventosDeUsuario = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const usuarioId = assertParamId(req.params.id, 'usuario');

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
        creador: { select: { id: true, nombre: true } },
        transacciones: { select: { estado: true } }
      },
      orderBy: { fecha: 'desc' }
    });

    const data = eventos.map((evento) => {
      const totalTx = evento.transacciones.length;
      const completadasTx = evento.transacciones.filter((t) => t.estado === 'COMPLETADO').length;
      const estaSaldado =
        evento.estado === 'CERRADO' && (totalTx === 0 || completadasTx === totalTx);

      return {
        id: evento.id,
        nombre: evento.nombre,
        estado: evento.estado,
        fecha: evento.fecha,
        total_gastado_centavos: evento.total_gastado_centavos,
        numero_comensales: evento._count.participantes,
        es_creador: evento.creador.id === usuarioId,
        creador: evento.creador,
        esta_saldado: estaSaldado,
        total_transacciones: totalTx,
        transacciones_completadas: completadasTx,
        transacciones_pendientes: totalTx - completadasTx
      };
    });

    res.status(200).json({ success: true, message: 'Eventos obtenidos', data });
  } catch (error) {
    next(error);
  }
};
