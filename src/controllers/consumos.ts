import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { crearConsumoSchema } from '../validators/consumos.js';
import { repartirCentavosExactos } from '../utils/money.js';

type CuerpoConsumo = z.infer<typeof crearConsumoSchema>;

// Registrar un consumo (individual o compartido) y sumar los centavos
// a los participantes y al total del evento. Todo en una transacción atómica.
export const registrarConsumo = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: rutaId } = req.params;
    const { descripcion, monto_centavos, participante_ids } = req.body as CuerpoConsumo;

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
      throw new HttpError(409, 'No puedes registrar consumos en una cuenta cerrada');
    }

    // 2. Sin participantes duplicados en el mismo consumo
    const idsUnicos = [...new Set(participante_ids)];
    if (idsUnicos.length !== participante_ids.length) {
      throw new HttpError(400, 'No puedes enviar el mismo participante dos veces');
    }

    // 3. Todos los participantes deben pertenecer a este evento
    const participantes = await prisma.participante.findMany({
      where: { id: { in: participante_ids }, evento_id },
      select: { id: true }
    });
    if (participantes.length !== participante_ids.length) {
      throw new HttpError(400, 'Algunos participantes no pertenecen a este evento');
    }

    // 4. Reparto exacto: la suma de las partes SIEMPRE cuadra con el total
    const partes = repartirCentavosExactos(monto_centavos, participante_ids.length);

    // 5. Todo dentro de una transacción atómica (regla de negocio #2)
    await prisma.$transaction(async (tx) => {
      for (let i = 0; i < participante_ids.length; i++) {
        await tx.participante.update({
          where: { id: participante_ids[i] ?? '' },
          data: { monto_consumido_centavos: { increment: partes[i] ?? 0 } }
        });
      }

      await tx.evento.update({
        where: { id: evento_id },
        data: { total_gastado_centavos: { increment: monto_centavos } }
      });
    });

    res.status(201).json({
      success: true,
      message: 'Consumo registrado',
      data: {
        descripcion: descripcion ?? null,
        monto_centavos,
        repartido: partes
      }
    });
  } catch (error) {
    next(error);
  }
};