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
// Si se despliega detrás de proxy (nginx, Cloudflare, etc.), descomenta:
// app.set('trust proxy', 1);
// Si el frontend está en otro origen, habilita CORS:
// import cors from 'cors'; app.use(cors({ origin: process.env.FRONTEND_URL }));

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

// Rutas de la API
app.use('/api', healthRouter);
app.use('/api', usuariosRouter);
app.use('/api', eventosRouter);
app.use('/api', transaccionesRouter);

// Manejo de errores (siempre al final)
app.use(notFound);
app.use(errorHandler);