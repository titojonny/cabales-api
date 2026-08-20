import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { calcularBalances, flujoMinimoEfectivo } from '../utils/settlement.js';

// POST /api/events/:id/close — Liquidar la mesa
// Transacción atómica masiva: cambia estado a CERRADO + genera Transacciones mínimas
export const cerrarEvento = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: rutaId } = req.params;

    if (typeof rutaId !== 'string' || rutaId.length === 0) {
      throw new HttpError(400, 'Falta el id del evento');
    }
    const eventoId = rutaId;

    const evento = await prisma.evento.findUnique({
      where: { id: eventoId },
      include: { participantes: true }
    });

    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }
    if (evento.estado === 'CERRADO') {
      throw new HttpError(409, 'La mesa ya está cerrada');
    }
    if (evento.participantes.length < 2) {
      throw new HttpError(400, 'La mesa necesita al menos 2 participantes para liquidar');
    }

    const { deudores, acreedores } = calcularBalances(evento.participantes);
    const transferencias = flujoMinimoEfectivo(deudores, acreedores);

    // Todo dentro de una transacción atómica (regla de negocio #2)
    const resultado = await prisma.$transaction(async (tx) => {
      await tx.evento.update({
        where: { id: eventoId },
        data: { estado: 'CERRADO' }
      });

      if (transferencias.length > 0) {
        await tx.transaccion.createMany({
          data: transferencias.map((t) => ({
            evento_id: eventoId,
            deudor_id: t.deudorId,
            acreedor_id: t.acreedorId,
            monto_centavos: t.monto_centavos
          }))
        });
      }

      const eventoCerrado = await tx.evento.findUnique({
        where: { id: eventoId },
        include: {
          participantes: {
            include: { usuario: { select: { id: true, nombre: true, avatar_url: true } } }
          },
          transacciones: true
        }
      });

      return { evento: eventoCerrado, transferencias };
    });

    res.status(201).json({
      success: true,
      message: 'Mesa liquidada',
      data: {
        evento: resultado.evento,
        transacciones: resultado.transferencias
      }
    });
  } catch (error) {
    next(error);
  }
};