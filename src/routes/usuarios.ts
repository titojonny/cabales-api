import { Router } from 'express';
import { validateBody } from '../middlewares/validateBody.js';
import { crearUsuario } from '../controllers/usuarios.js';
import { obtenerEventosDeUsuario } from '../controllers/usuarios.js';
import { crearUsuarioSchema } from '../validators/schemas.js';

const router = Router();

// Crear un usuario nuevo
router.post('/users', validateBody(crearUsuarioSchema), crearUsuario);

// Dashboard: eventos donde el usuario es creador o participante
router.get('/users/:id/events', obtenerEventosDeUsuario);

export default router;