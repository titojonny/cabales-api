import { Router } from 'express';
import { validateBody } from '../middlewares/validateBody.js';
import { assertParamId } from '../middlewares/assertParamId.js';
import { crearUsuario, listarUsuarios, obtenerEventosDeUsuario, actualizarUsuario } from '../controllers/usuarios.js';
import { crearUsuarioSchema, actualizarUsuarioSchema } from '../validators/schemas.js';

const router = Router();

// Listar usuarios registrados
router.get('/users', listarUsuarios);

// Crear un usuario nuevo
router.post('/users', validateBody(crearUsuarioSchema), crearUsuario);

// Actualizar perfil de usuario
router.patch('/users/:id', assertParamId('usuario'), validateBody(actualizarUsuarioSchema), actualizarUsuario);

// Dashboard: eventos donde el usuario es creador o participante
router.get('/users/:id/events', assertParamId('usuario'), obtenerEventosDeUsuario);

export default router;