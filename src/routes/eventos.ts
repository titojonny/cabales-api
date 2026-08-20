import { NextFunction, Request, Response, Router } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';
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

export default router;