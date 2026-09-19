import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { Prisma } from '@prisma/client';
import { crearEventoSchema } from '../validators/schemas.js';

type CuerpoEvento = z.infer<typeof crearEventoSchema>;

// Crear un evento nuevo
export const crearEvento = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { nombre, creador_id, auto_incluir_creador } = req.body as CuerpoEvento;

    const creador = await prisma.usuario.findUnique({ where: { id: creador_id } });
    if (!creador) {
      throw new HttpError(404, 'El usuario creador no existe');
    }

    const nuevoEvento = await prisma.evento.create({
      data: {
        nombre,
        creador_id,
        ...(auto_incluir_creador
          ? {
              participantes: {
                create: {
                  usuario_id: creador_id
                }
              }
            }
          : {})
      }
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
    const eventoId = assertParamId(req.params.id, 'evento');

    const evento = await prisma.evento.findUnique({
      where: { id: eventoId },
      include: {
        creador: { select: { id: true, nombre: true, avatar_url: true } },
        participantes: {
          orderBy: { monto_consumido_centavos: 'desc' },
          include: { usuario: { select: { id: true, nombre: true, avatar_url: true } } }
        },
        transacciones: {
          select: {
            id: true,
            deudor_id: true,
            acreedor_id: true,
            monto_centavos: true,
            estado: true
          }
        },
        _count: { select: { participantes: true, transacciones: true } }
      }
    });

    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }

    const totalTx = evento.transacciones.length;
    const completadasTx = evento.transacciones.filter((t) => t.estado === 'COMPLETADO').length;
    const estaTotalmenteSaldado =
      evento.estado === 'CERRADO' && (totalTx === 0 || completadasTx === totalTx);

    const data = {
      id: evento.id,
      nombre: evento.nombre,
      fecha: evento.fecha,
      estado: evento.estado,
      total_gastado_centavos: evento.total_gastado_centavos,
      numero_comensales: evento._count.participantes,
      numero_transacciones: evento._count.transacciones,
      total_transacciones: totalTx,
      transacciones_completadas: completadasTx,
      transacciones_pendientes: totalTx - completadasTx,
      esta_totalmente_saldado: estaTotalmenteSaldado,
      creador: evento.creador,
      transacciones: evento.transacciones,
      participantes: evento.participantes.map((participante) => {
        const txsDeudor = evento.transacciones.filter((t) => t.deudor_id === participante.id);
        const txsAcreedor = evento.transacciones.filter((t) => t.acreedor_id === participante.id);
        const deudaPendiente = txsDeudor
          .filter((t) => t.estado !== 'COMPLETADO')
          .reduce((acc, t) => acc + t.monto_centavos, 0);
        const porCobrarPendiente = txsAcreedor
          .filter((t) => t.estado !== 'COMPLETADO')
          .reduce((acc, t) => acc + t.monto_centavos, 0);
        const deudaSaldada = txsDeudor
          .filter((t) => t.estado === 'COMPLETADO')
          .reduce((acc, t) => acc + t.monto_centavos, 0);

        return {
          id: participante.id,
          nombre_visible: participante.usuario?.nombre ?? participante.nombre_invitado,
          es_fantasma: !participante.usuario,
          usuario_id: participante.usuario_id,
          monto_consumido_centavos: participante.monto_consumido_centavos,
          monto_pagado_centavos: participante.monto_pagado_centavos,
          deuda_pendiente_centavos: deudaPendiente,
          por_cobrar_pendiente_centavos: porCobrarPendiente,
          deuda_saldada_centavos: deudaSaldada,
          esta_saldado:
            evento.estado === 'CERRADO' && deudaPendiente === 0 && porCobrarPendiente === 0
        };
      })
    };

    res.status(200).json({ success: true, message: 'Evento obtenido', data });
  } catch (error) {
    next(error);
  }
};
