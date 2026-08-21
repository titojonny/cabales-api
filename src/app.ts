import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import eventosRouter from './routes/eventos.js';
import healthRouter from './routes/health.js';
import transaccionesRouter from './routes/transacciones.js';
import usuariosRouter from './routes/usuarios.js';

export const app = express();

// Seguridad básica: cabeceras HTTP y límite de peticiones por IP
app.use(helmet());
app.use(
  '/api',
  rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, message: 'Demasiadas peticiones, intenta más tarde' }
  })
);

// Middleware para que Express entienda JSON
app.use(express.json());

// Rutas de la API
app.use('/api', healthRouter);
app.use('/api', usuariosRouter);
app.use('/api', eventosRouter);
app.use('/api', transaccionesRouter);

// Manejo de errores (siempre al final)
app.use(notFound);
app.use(errorHandler);