import { Router } from 'express';
import { registrarPago } from '../controllers/pagos.js';
import { obtenerTransaccionesDeEvento } from '../controllers/transacciones.js';
import { cerrarEvento } from '../controllers/cierre.js';
import { obtenerEventoDetalle, crearEvento } from '../controllers/eventos.js';
import { registrarConsumo } from '../controllers/consumos.js';
import { agregarParticipante } from '../controllers/participantes.js';
import { validateBody } from '../middlewares/validateBody.js';
import { registrarPagoSchema } from '../validators/pagos.js';
import { crearConsumoSchema } from '../validators/consumos.js';
import { agregarParticipanteSchema } from '../validators/participantes.js';
import { crearEventoSchema } from '../validators/schemas.js';

const router = Router();

// Crear un evento nuevo
router.post('/events', validateBody(crearEventoSchema), crearEvento);

// Detalle de un evento (radiografía de la mesa)
router.get('/events/:id', obtenerEventoDetalle);

// Agregar un comensal a la mesa (usuario registrado o invitado fantasma)
router.post('/events/:id/participants', validateBody(agregarParticipanteSchema), agregarParticipante);

// Registrar un consumo individual o compartido en centavos
router.post('/events/:id/consumptions', validateBody(crearConsumoSchema), registrarConsumo);

// Registrar un pago en centavos (acumula a monto_pagado_centavos)
router.post('/events/:id/payments', validateBody(registrarPagoSchema), registrarPago);

// Listar transacciones de un evento (Quién le debe a quién)
router.get('/events/:id/transactions', obtenerTransaccionesDeEvento);

// Liquidar la mesa — motor de flujo mínimo de efectivo
router.post('/events/:id/close', cerrarEvento);

export default router;