import { Router } from 'express';
import { prisma } from '../config/prisma.js';

const router = Router();

// Ruta de prueba (Health Check)
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: '¡El servidor de Cabales está vivo!',
    timestamp: new Date()
  });
});

// Ruta rápida para probar que Prisma lee la base de datos
router.get('/test-db', async (req, res) => {
  try {
    const eventos = await prisma.evento.findMany();
    res.status(200).json({
      success: true,
      data: eventos
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      message: 'Error conectando a la base de datos'
    });
  }
});

export default router;