import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import type { AppConfig } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import type { AuthPort } from '../modules/auth/auth.service.js';
import { createAuthRouter } from '../modules/auth/auth.router.js';
import type { EventsService } from '../modules/events/events.service.js';
import { createEventsRouter } from '../modules/events/events.router.js';
import type { ExpensesService } from '../modules/expenses/expenses.service.js';
import { createExpensesRouter } from '../modules/expenses/expenses.router.js';
import type { GroupsService } from '../modules/groups/groups.service.js';
import { createGroupsRouter } from '../modules/groups/groups.router.js';
import type { SettlementsService } from '../modules/settlements/settlements.service.js';
import { createSettlementsRouter } from '../modules/settlements/settlements.router.js';
import { AppError } from '../shared/errors.js';
import {
  errorHandler,
  notFound,
  privateNoStore,
  requestContext,
  requireAuth,
  requireCsrf,
} from './middleware.js';
import { sendData } from './response.js';

/** Dependencias explícitas de la composición HTTP, sustituibles en pruebas. */
export interface AppDependencies {
  config: AppConfig;
  logger: AppLogger;
  auth: AuthPort;
  groups: GroupsService;
  events: EventsService;
  expenses: ExpensesService;
  settlements: SettlementsService;
  readiness: () => Promise<boolean>;
}

function limiter(max: number, message: string) {
  return rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res) => {
      if (!res.hasHeader('Cache-Control')) res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message, requestId: req.requestId },
      });
    },
  });
}

function protectMutations(cookieName: string) {
  const csrf = requireCsrf(cookieName);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) next();
    else csrf(req, res, next);
  };
}

/** Ensambla el monolito modular; recibe dependencias para mantener pruebas aisladas. */
export function createApp(dependencies: AppDependencies) {
  const { config, logger } = dependencies;
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestContext);
  app.use(helmet());
  app.use('/api/v1', privateNoStore);
  app.use(['/health', '/ready'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  app.use(limiter(config.RATE_LIMIT_MAX, 'Demasiadas solicitudes'));
  app.use(
    cors({
      credentials: true,
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
        else callback(new AppError(403, 'CORS_ORIGIN_DENIED', 'Origen no permitido'));
      },
    }),
  );
  app.use(express.json({ limit: '32kb', strict: true }));
  app.use(cookieParser());

  app.get('/health', (_req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    sendData(res, { status: 'up' });
  });
  app.get('/ready', async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const ready = await dependencies.readiness().catch(() => false);
    if (ready) sendData(res, { status: 'ready' });
    else {
      res.status(503).json({
        success: false,
        error: {
          code: 'NOT_READY',
          message: 'La base de datos no esta disponible',
          requestId: req.requestId,
        },
      });
    }
  });

  const v1 = Router();
  const authLimiter = limiter(config.AUTH_RATE_LIMIT_MAX, 'Demasiados intentos de autenticacion');
  v1.use('/auth/login', authLimiter);
  v1.use('/auth/register', authLimiter);
  v1.use('/auth', createAuthRouter(dependencies.auth, config));

  const authenticated = Router();
  authenticated.use(requireAuth(dependencies.auth, config.COOKIE_NAME));
  authenticated.use(protectMutations(config.COOKIE_NAME));
  authenticated.use('/groups', createGroupsRouter(dependencies.groups));
  authenticated.use('/groups/:groupId/events', createEventsRouter(dependencies.events));
  authenticated.use('/groups/:groupId/expenses', createExpensesRouter(dependencies.expenses));
  authenticated.use(
    '/groups/:groupId/settlements',
    createSettlementsRouter(dependencies.settlements),
  );
  v1.use(authenticated);
  app.use('/api/v1', v1);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
