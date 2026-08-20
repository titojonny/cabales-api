import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';

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
