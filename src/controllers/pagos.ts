import { NextFunction, Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { registrarPagoSchema } from '../validators/pagos.js';

type CuerpoPago = z.infer<typeof registrarPagoSchema>;

// Registrar que un comensal pagó (suma a monto_pagado_centavos).
// Soporta pagos parciales: 3000 + 2000 acumulan sin necesidad de leer el total previo.
export const registrarPago = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id: rutaId } = req.params;
    const { participante_id, monto_centavos } = req.body as CuerpoPago;

    if (typeof rutaId !== 'string' || rutaId.length === 0) {
      throw new HttpError(400, 'Falta el id del evento');
    }
    const eventoId = rutaId;

    const evento = await prisma.evento.findUnique({ where: { id: eventoId } });
    if (!evento) {
      throw new HttpError(404, 'El evento no existe');
    }
    if (evento.estado === 'CERRADO') {
      throw new HttpError(409, 'No puedes registrar pagos en una cuenta cerrada');
    }

    const participante = await prisma.participante.findFirst({
      where: { id: participante_id, evento_id: eventoId }
    });
    if (!participante) {
      throw new HttpError(400, 'El participante no pertenece a este evento');
    }

    const actualizado = await prisma.$transaction(async (tx) => {
      return tx.participante.update({
        where: { id: participante_id },
        data: { monto_pagado_centavos: { increment: monto_centavos } }
      });
    });

    res.status(201).json({
      success: true,
      message: 'Pago registrado',
      data: actualizado
    });
  } catch (error) {
    next(error);
  }
};