import { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { calcularBalances, flujoMinimoEfectivo } from '../utils/settlement.js';

// POST /api/events/:id/close — Liquidar la mesa
// Transacción atómica masiva: cambia estado a CERRADO + genera Transacciones mínimas
export const cerrarEvento = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const eventoId = req.evento!.id;

    const participantes = await prisma.participante.findMany({
      where: { evento_id: eventoId }
    });

    if (participantes.length < 2) {
      throw new HttpError(400, 'La mesa necesita al menos 2 participantes para liquidar');
    }

    const totalConsumido = participantes.reduce((acc, p) => acc + p.monto_consumido_centavos, 0);
    const totalPagado = participantes.reduce((acc, p) => acc + p.monto_pagado_centavos, 0);
    const saldoPendiente = totalConsumido - totalPagado;

    const { pagador_restante_id } = (req.body || {}) as { pagador_restante_id?: string };

    if (saldoPendiente > 0) {
      if (!pagador_restante_id) {
        throw new HttpError(
          400,
          `Faltan pagos por registrar en la mesa: el total consumido es de ${totalConsumido} centavos y solo se han cubierto ${totalPagado} centavos. Indica qué comensal cubrió los ${saldoPendiente} centavos restantes con pagador_restante_id.`
        );
      }

      const pagadorExiste = participantes.some((p) => p.id === pagador_restante_id);
      if (!pagadorExiste) {
        throw new HttpError(400, 'El participante indicado como pagador_restante_id no pertenece a esta mesa');
      }
    }

    const participantesActualizados = participantes.map((p) => {
      if (saldoPendiente > 0 && p.id === pagador_restante_id) {
        return { ...p, monto_pagado_centavos: p.monto_pagado_centavos + saldoPendiente };
      }
      return p;
    });

    const { deudores, acreedores } = calcularBalances(participantesActualizados);
    const transferencias = flujoMinimoEfectivo(deudores, acreedores);

    // Todo dentro de una transacción atómica (regla de negocio #2)
    const resultado = await prisma.$transaction(async (tx) => {
      if (saldoPendiente > 0 && pagador_restante_id) {
        await tx.participante.update({
          where: { id: pagador_restante_id },
          data: { monto_pagado_centavos: { increment: saldoPendiente } }
        });
      }

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