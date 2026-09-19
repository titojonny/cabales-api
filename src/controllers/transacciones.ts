import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { mapearParticipante } from '../utils/participante.js';
import { actualizarEstadoTransaccionSchema } from '../validators/transacciones.js';
import { esTransicionPermitida, SIETE_DIAS_MS } from '../utils/settlement.js';
import { storage } from '../services/storage.js';

type CuerpoEstado = z.infer<typeof actualizarEstadoTransaccionSchema>;

// GET /api/events/:id/transactions — lista completa, sin filtros (3-15 filas máximo)
export const obtenerTransaccionesDeEvento = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const eventoId = assertParamId(req.params.id, 'evento');

    const evento = await prisma.evento.findUnique({ where: { id: eventoId }, select: { id: true } });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }

    const transacciones = await prisma.transaccion.findMany({
      where: { evento_id: eventoId },
      include: {
        deudor: { include: { usuario: { select: { id: true, nombre: true, avatar_url: true } } } },
        acreedor: { include: { usuario: { select: { id: true, nombre: true, avatar_url: true } } } }
      },
      orderBy: { creado_en: 'asc' }
    });

    const data = transacciones.map((t) => ({
      id: t.id,
      evento_id: t.evento_id,
      monto_centavos: t.monto_centavos,
      estado: t.estado,
      comprobante_url: t.comprobante_url,
      fecha_limite: t.fecha_limite,
      creado_en: t.creado_en,
      actualizado_en: t.actualizado_en,
      deudor: mapearParticipante(t.deudor),
      acreedor: mapearParticipante(t.acreedor)
    }));

    res.status(200).json({ success: true, message: 'Transacciones obtenidas', data });
  } catch (error) {
    next(error);
  }
};

// PATCH /api/transactions/:id/status — máquina de estados
export const actualizarEstadoTransaccion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const transaccionId = assertParamId(req.params.id, 'transacción');
    const { estado: nuevoEstado, comprobante_url } = req.body as CuerpoEstado;

    const transaccion = await prisma.transaccion.findUnique({ where: { id: transaccionId } });
    if (!transaccion) {
      throw new HttpError(404, 'La transacción no existe');
    }

    if (transaccion.estado === nuevoEstado) {
      res.status(200).json({ success: true, message: 'La transacción ya está en ese estado', data: transaccion });
      return;
    }

    if (!esTransicionPermitida(transaccion.estado, nuevoEstado)) {
      throw new HttpError(409, `Transición de ${transaccion.estado} a ${nuevoEstado} no permitida`);
    }

    const actualizada = await prisma.transaccion.update({
      where: { id: transaccionId },
      data: {
        estado: nuevoEstado,
        ...(comprobante_url !== undefined ? { comprobante_url } : {}),
        ...(nuevoEstado === 'EN_REVISION' ? { fecha_limite: new Date(Date.now() + SIETE_DIAS_MS) } : {})
      }
    });

    res.status(200).json({ success: true, message: 'Estado actualizado', data: actualizada });
  } catch (error) {
    next(error);
  }
};

// POST /api/transactions/:id/comprobante — subida de imagen de comprobante bancario
export const subirComprobanteTransaccion = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const transaccionId = assertParamId(req.params.id, 'transacción');

    if (!req.file) {
      throw new HttpError(400, 'Debes adjuntar un archivo de imagen como comprobante');
    }

    const transaccion = await prisma.transaccion.findUnique({ where: { id: transaccionId } });
    if (!transaccion) {
      throw new HttpError(404, 'La transacción no existe');
    }

    if (transaccion.estado === 'COMPLETADO') {
      throw new HttpError(409, 'La transacción ya está completada, no requiere comprobante');
    }

    if (!esTransicionPermitida(transaccion.estado, 'EN_REVISION') && transaccion.estado !== 'EN_REVISION') {
      throw new HttpError(409, `No se puede subir comprobante: la transacción está en estado ${transaccion.estado}`);
    }

    const { url: comprobanteUrl } = await storage.upload(req.file, 'comprobantes');

    const actualizada = await prisma.transaccion.update({
      where: { id: transaccionId },
      data: {
        estado: 'EN_REVISION',
        comprobante_url: comprobanteUrl,
        fecha_limite: new Date(Date.now() + SIETE_DIAS_MS)
      }
    });

    res.status(200).json({
      success: true,
      message: 'Comprobante subido exitosamente y enviado a revisión',
      data: actualizada
    });
  } catch (error) {
    next(error);
  }
};