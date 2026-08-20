import { NextFunction, Request, Response, Router } from 'express';
import { prisma } from '../config/prisma.js';
import { registrarPago } from '../controllers/pagos.js';
import { cerrarEvento } from '../controllers/cierre.js';
import { obtenerEventoDetalle } from '../controllers/eventos.js';
import { registrarConsumo } from '../controllers/consumos.js';
import { agregarParticipante } from '../controllers/participantes.js';
import { HttpError } from '../middlewares/errorHandler.js';
import { validateBody } from '../middlewares/validateBody.js';
import { registrarPagoSchema } from '../validators/pagos.js';
import { crearConsumoSchema } from '../validators/consumos.js';
import { agregarParticipanteSchema } from '../validators/participantes.js';
import { crearEventoSchema } from '../validators/schemas.js';

const router = Router();

// Crear un evento nuevo
router.post('/events', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
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
    next(error);
  }
});

// Detalle de un evento (radiografía de la mesa)
router.get('/events/:id', obtenerEventoDetalle);

// Agregar un comensal a la mesa (usuario registrado o invitado fantasma)
router.post('/events/:id/participants', validateBody(agregarParticipanteSchema), agregarParticipante);

// Registrar un consumo individual o compartido en centavos
router.post('/events/:id/consumptions', validateBody(crearConsumoSchema), registrarConsumo);

// Registrar un pago en centavos (acumula a monto_pagado_centavos)
router.post('/events/:id/payments', validateBody(registrarPagoSchema), registrarPago);

// Liquidar la mesa — motor de flujo mínimo de efectivo
router.post('/events/:id/close', cerrarEvento);

export default router;