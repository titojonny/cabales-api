import { NextFunction, Request, Response, Router } from 'express';
import { prisma } from '../config/prisma.js';
import { obtenerEventosDeUsuario } from '../controllers/usuarios.js';
import { crearUsuarioSchema } from '../validators/schemas.js';

const router = Router();

// Crear un usuario nuevo
router.post('/users', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const parse = crearUsuarioSchema.safeParse(req.body);

    if (!parse.success) {
      res.status(400).json({
        success: false,
        message: 'Datos inválidos',
        error: parse.error.issues.map((issue) => issue.message)
      });
      return;
    }

    const { nombre, email } = parse.data;
    const nuevoUsuario = await prisma.usuario.create({
      data: { nombre, email }
    });

    res.status(201).json({ success: true, message: 'Usuario creado', data: nuevoUsuario });
  } catch (error) {
    next(error);
  }
});

// Dashboard: eventos donde el usuario es creador o participante
router.get('/users/:id/events', obtenerEventosDeUsuario);

export default router;