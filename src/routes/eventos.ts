import { Router } from 'express';
import { registrarPago } from '../controllers/pagos.js';
import { obtenerTransaccionesDeEvento } from '../controllers/transacciones.js';
import { cerrarEvento } from '../controllers/cierre.js';
import { obtenerEventoDetalle, crearEvento } from '../controllers/eventos.js';
import {
  registrarConsumo,
  obtenerConsumosDeEvento,
  actualizarConsumo,
  eliminarConsumo,
  agregarPropina
} from '../controllers/consumos.js';
import { agregarParticipante } from '../controllers/participantes.js';
import { validateBody } from '../middlewares/validateBody.js';
import { requireEventoAbierto } from '../middlewares/requireEventoAbierto.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { registrarPagoSchema } from '../validators/pagos.js';
import {
  crearConsumoSchema,
  actualizarConsumoSchema,
  agregarPropinaSchema
} from '../validators/consumos.js';
import { agregarParticipanteSchema } from '../validators/participantes.js';
import { crearEventoSchema } from '../validators/schemas.js';

const router = Router();

// Crear un evento nuevo
router.post('/events', validateBody(crearEventoSchema), crearEvento);

// Detalle de un evento (radiografía de la mesa)
router.get('/events/:id', assertParamId('evento'), obtenerEventoDetalle);

// Agregar un comensal a la mesa (usuario registrado o invitado fantasma)
router.post(
  '/events/:id/participants',
  assertParamId('evento'),
  requireEventoAbierto,
  validateBody(agregarParticipanteSchema),
  agregarParticipante
);

// Listar consumos detallados de un evento
router.get('/events/:id/consumptions', assertParamId('evento'), obtenerConsumosDeEvento);

// Registrar un consumo individual o compartido en centavos
router.post(
  '/events/:id/consumptions',
  assertParamId('evento'),
  requireEventoAbierto,
  validateBody(crearConsumoSchema),
  registrarConsumo
);

// Modificar un consumo existente (monto, comensales o descripción)
router.put(
  '/events/:id/consumptions/:consumoId',
  assertParamId('evento'),
  requireEventoAbierto,
  validateBody(actualizarConsumoSchema),
  actualizarConsumo
);

// Eliminar un consumo (reversión atómica de balances)
router.delete(
  '/events/:id/consumptions/:consumoId',
  assertParamId('evento'),
  requireEventoAbierto,
  eliminarConsumo
);

// Agregar propina automática calculada (10% sugerido)
router.post(
  '/events/:id/tip',
  assertParamId('evento'),
  requireEventoAbierto,
  validateBody(agregarPropinaSchema),
  agregarPropina
);

// Registrar un pago en centavos (acumula a monto_pagado_centavos)
router.post(
  '/events/:id/payments',
  assertParamId('evento'),
  requireEventoAbierto,
  validateBody(registrarPagoSchema),
  registrarPago
);

// Listar transacciones de un evento (Quién le debe a quién)
router.get('/events/:id/transactions', assertParamId('evento'), obtenerTransaccionesDeEvento);

// Liquidar la mesa — motor de flujo mínimo de efectivo
router.post('/events/:id/close', assertParamId('evento'), requireEventoAbierto, cerrarEvento);

export default router;