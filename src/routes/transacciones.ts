import { Router } from 'express';
import { actualizarEstadoTransaccion } from '../controllers/transacciones.js';
import { validateBody } from '../middlewares/validateBody.js';
import { actualizarEstadoTransaccionSchema } from '../validators/transacciones.js';

const router = Router();

// Máquina de estados de una transacción (PENDIENTE -> EN_REVISION -> COMPLETADO, etc.)
router.patch('/transactions/:id/status', validateBody(actualizarEstadoTransaccionSchema), actualizarEstadoTransaccion);

export default router;