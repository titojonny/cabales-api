// src/index.ts
import 'dotenv/config';
import express, { Request, Response } from 'express';
import { Prisma, PrismaClient } from '@prisma/client';
import { PrismaBetterSqlite3 } from '@prisma/adapter-better-sqlite3';

// Inicializamos Express y Prisma
const app = express();
const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL || 'file:./dev.db',
});
const prisma = new PrismaClient({ adapter });

// Middleware para que Express entienda JSON
app.use(express.json());

// Ruta de prueba (Health Check)
app.get('/api/health', (req: Request, res: Response) => {
  res.status(200).json({
    success: true,
    message: '¡El servidor de Cabales está vivo!',
    timestamp: new Date()
  });
});

// Ruta rápida para probar que Prisma lee la base de datos
app.get('/api/test-db', async (req: Request, res: Response) => {
  try {
    // Intentamos buscar todos los eventos (debería devolver un arreglo vacío ahorita)
    const eventos = await prisma.evento.findMany();
    res.status(200).json({
      success: true,
      data: eventos
    });
  } catch (error: any) {
    res.status(500).json({
      success: false,
      message: 'Error conectando a la base de datos',
      error: error.message
    });
  }
});

// --- RUTAS DE USUARIOS ---

// Crear un usuario nuevo
app.post('/api/users', async (req: Request, res: Response): Promise<void> => {
  try {
    const { nombre, email } = req.body;

    if (!nombre || !email) {
      res.status(400).json({ success: false, message: 'Faltan campos obligatorios: nombre y email son requeridos' });
      return;
    }

    const nuevoUsuario = await prisma.usuario.create({
      data: { nombre, email }
    });

    res.status(201).json({ success: true, data: nuevoUsuario });
  } catch (error: any) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      res.status(409).json({ success: false, message: 'Ya existe un usuario con ese email' });
      return;
    }
    res.status(400).json({ success: false, message: 'Error creando usuario', error: error.message });
  }
});

// --- RUTAS DE EVENTOS ---

// Crear un evento nuevo
app.post('/api/events', async (req: Request, res: Response): Promise<void> => {
  try {
    const { nombre, creador_id } = req.body;

    if (!nombre || !creador_id) {
      res.status(400).json({ success: false, message: 'Faltan campos obligatorios: nombre y creador_id son requeridos' });
      return;
    }

    const creador = await prisma.usuario.findUnique({ where: { id: creador_id } });
    if (!creador) {
      res.status(404).json({ success: false, message: 'El usuario creador no existe' });
      return;
    }

    const nuevoEvento = await prisma.evento.create({
      data: {
        nombre: nombre,
        creador_id: creador_id
      }
    });

    res.status(201).json({ success: true, message: '¡Salida creada!', data: nuevoEvento });
  } catch (error: any) {
    res.status(400).json({ success: false, message: 'Error creando evento', error: error.message });
  }
});

// Levantar el servidor
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor corriendo en http://localhost:${PORT}`);
});