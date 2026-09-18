import { Router } from 'express';
import { actualizarEstadoTransaccion, subirComprobanteTransaccion } from '../controllers/transacciones.js';
import { validateBody } from '../middlewares/validateBody.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { actualizarEstadoTransaccionSchema } from '../validators/transacciones.js';
import { uploadComprobante } from '../config/upload.js';

const router = Router();

// Subir imagen de captura bancaria como comprobante de pago
router.post(
  '/transactions/:id/comprobante',
  assertParamId('transacción'),
  uploadComprobante.single('comprobante'),
  subirComprobanteTransaccion
);

// Máquina de estados de una transacción (PENDIENTE -> EN_REVISION -> COMPLETADO, etc.)
router.patch('/transactions/:id/status', assertParamId('transacción'), validateBody(actualizarEstadoTransaccionSchema), actualizarEstadoTransaccion);

export default router;