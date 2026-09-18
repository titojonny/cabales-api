import path from 'node:path';
import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { corsMiddleware } from './config/cors.js';
import { errorHandler, notFound } from './middlewares/errorHandler.js';
import eventosRouter from './routes/eventos.js';
import healthRouter from './routes/health.js';
import transaccionesRouter from './routes/transacciones.js';
import usuariosRouter from './routes/usuarios.js';

export const app = express();

// Confianza en proxies inversos (ej. Nginx, Fly.io, Railway, Render)
app.set('trust proxy', 1);

// Habilitar CORS para Angular, Ionic dev servers y WebView Capacitor
app.use(corsMiddleware);

// Seguridad HTTP permitiendo consumo cross-origin de recursos
app.use(
  helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  })
);

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

// Middleware para que Express entienda JSON con límite de payload
app.use(express.json({ limit: '10kb' }));

// Servir estáticamente archivos subidos (comprobantes de pago)
app.use('/uploads', express.static(path.join(process.cwd(), 'uploads')));

// Rutas de la API
app.use('/api', healthRouter);
app.use('/api', usuariosRouter);
app.use('/api', eventosRouter);
app.use('/api', transaccionesRouter);

// Manejo de errores (siempre al final)
app.use(notFound);
app.use(errorHandler);