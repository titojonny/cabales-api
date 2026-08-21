import { NextFunction, Request, Response, Router } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from '../middlewares/errorHandler.js';

const router = Router();

// Ruta de prueba (Health Check)
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: '¡El servidor de Cabales está vivo!',
    timestamp: new Date().toISOString()
  });
});

// Ruta rápida para probar que Prisma lee la base de datos
router.get('/test-db', async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const eventos = await prisma.evento.findMany();
    res.status(200).json({
      success: true,
      data: eventos
    });
  } catch (error) {
    next(error);
  }
});

export default router;