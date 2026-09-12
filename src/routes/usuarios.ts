import { Router } from 'express';
import { validateBody } from '../middlewares/validateBody.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { crearUsuario, obtenerEventosDeUsuario } from '../controllers/usuarios.js';
import { crearUsuarioSchema } from '../validators/schemas.js';

const router = Router();

// Crear un usuario nuevo
router.post('/users', validateBody(crearUsuarioSchema), crearUsuario);

// Dashboard: eventos donde el usuario es creador o participante
router.get('/users/:id/events', assertParamId('usuario'), obtenerEventosDeUsuario);

export default router;