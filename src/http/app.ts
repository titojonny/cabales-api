import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, {
  Router,
  type Express,
  type NextFunction,
  type Request,
  type RequestHandler,
  type Response,
} from 'express';
import helmet from 'helmet';
import type { AppConfig } from '../config/env.js';
import type { AppLogger } from '../config/logger.js';
import {
  createLimiter,
  createRateLimitStoreFactory,
  type RateLimitStoreFactory,
} from '../infrastructure/rate-limit.js';
import type { LocalFileStorageProvider } from '../infrastructure/storage.js';
import type { AchievementsService } from '../modules/achievements/achievements.service.js';
import { createAchievementsRouter } from '../modules/achievements/achievements.router.js';
import type { AuthPort } from '../modules/auth/auth.service.js';
import { createAuthRouter } from '../modules/auth/auth.router.js';
import type { BudgetsService } from '../modules/budgets/budgets.service.js';
import { createBudgetsRouter } from '../modules/budgets/budgets.router.js';
import type { CabudasService } from '../modules/cabudas/cabudas.service.js';
import { createCabudasRouter } from '../modules/cabudas/cabudas.router.js';
import type { DocumentsService } from '../modules/documents/documents.service.js';
import {
  createDocumentsRouter,
  createLocalStorageRouter,
} from '../modules/documents/documents.router.js';
import type { EventsService } from '../modules/events/events.service.js';
import { createEventsRouter } from '../modules/events/events.router.js';
import type { ExpensesService } from '../modules/expenses/expenses.service.js';
import { createExpensesRouter } from '../modules/expenses/expenses.router.js';
import type { FundsService } from '../modules/funds/funds.service.js';
import { createFundsRouter } from '../modules/funds/funds.router.js';
import type { GroupsService } from '../modules/groups/groups.service.js';
import { createGroupsRouter } from '../modules/groups/groups.router.js';
import type { NotificationsService } from '../modules/notifications/notifications.service.js';
import { createNotificationsRouter } from '../modules/notifications/notifications.router.js';
import type { OcrService } from '../modules/ocr/ocr.service.js';
import { createOcrRouter } from '../modules/ocr/ocr.router.js';
import type { PrivacyService } from '../modules/privacy/privacy.service.js';
import { createPrivacyRouter } from '../modules/privacy/privacy.router.js';
import type { SettlementsService } from '../modules/settlements/settlements.service.js';
import { createSettlementsRouter } from '../modules/settlements/settlements.router.js';
import type { StatisticsService } from '../modules/statistics/statistics.service.js';
import { createStatisticsRouter } from '../modules/statistics/statistics.router.js';
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
  rateLimitStores?: RateLimitStoreFactory;
  privacy?: PrivacyService;
  documents?: DocumentsService;
  localStorage?: LocalFileStorageProvider;
  ocr?: OcrService;
  funds?: FundsService;
  budgets?: BudgetsService;
  cabudas?: CabudasService;
  statistics?: StatisticsService;
  notifications?: NotificationsService;
  achievements?: AchievementsService;
}

function protectMutations(cookieName: string) {
  const csrf = requireCsrf(cookieName);
  return (req: Request, res: Response, next: NextFunction): void => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) next();
    else csrf(req, res, next);
  };
}

/** Ensambla el monolito modular; recibe dependencias para mantener pruebas aisladas. */
export function createApp(dependencies: AppDependencies): Express {
  const { config, logger } = dependencies;
  const stores = dependencies.rateLimitStores ?? createRateLimitStoreFactory('memory');
  const windowMs = config.rateLimitWindowMs;
  const limit = (
    name: string,
    max: number,
    key: 'ip' | 'user' | 'email',
    message: string,
    failOpen = false,
  ) => createLimiter({ name, max, windowMs, key, stores, message, failOpen });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', config.TRUST_PROXY);
  app.use(requestContext);
  app.use(
    helmet({
      // La PWA en cabales-app corre en otro origen (:5173); same-origin bloquearía el fetch con cookies.
      crossOriginResourcePolicy: { policy: 'cross-origin' },
    }),
  );
  app.use('/api/v1', privateNoStore);
  app.use(['/health', '/ready'], (_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  // CORS antes del límite global: un 429 debe ser legible por la PWA.
  app.use(
    cors({
      credentials: true,
      methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Accept',
        'X-CSRF-Token',
        'X-Request-Id',
        'X-Request-ID',
        'Idempotency-Key',
      ],
      exposedHeaders: [
        'X-Request-Id',
        'Retry-After',
        'RateLimit',
        'RateLimit-Policy',
        'Content-Disposition',
      ],
      maxAge: 600,
      origin(origin, callback) {
        if (!origin || config.corsOrigins.includes(origin)) callback(null, true);
        else callback(null, false);
      },
    }),
  );
  app.use(limit('global', config.RATE_LIMIT_MAX, 'ip', 'Demasiadas solicitudes', true));
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
  // Autenticación: por IP y, cuando hay correo en el cuerpo, por cuenta (freno a fuerza bruta distribuida).
  const authIp = limit(
    'auth-ip',
    config.AUTH_RATE_LIMIT_MAX,
    'ip',
    'Demasiados intentos de autenticacion',
  );
  const authEmail = limit(
    'auth-email',
    config.AUTH_RATE_LIMIT_MAX,
    'email',
    'Demasiados intentos para esta cuenta',
  );
  const recoveryIp = limit(
    'recovery-ip',
    config.RECOVERY_RATE_LIMIT_MAX * 4,
    'ip',
    'Demasiadas solicitudes de correo',
  );
  const recoveryEmail = limit(
    'recovery-email',
    config.RECOVERY_RATE_LIMIT_MAX,
    'email',
    'Demasiadas solicitudes para este correo',
  );
  const tokenIp = limit(
    'token-ip',
    config.AUTH_RATE_LIMIT_MAX * 2,
    'ip',
    'Demasiados intentos con enlaces',
  );
  v1.use(['/auth/login', '/auth/register'], authIp, authEmail);
  v1.use(
    [
      '/auth/email-verification/request',
      '/auth/email-verification/resend',
      '/auth/password-recovery/request',
      '/auth/password-recovery/resend',
    ],
    recoveryIp,
    recoveryEmail,
  );
  v1.use(['/auth/email-verification/confirm', '/auth/password-recovery/confirm'], tokenIp);
  v1.use('/auth', createAuthRouter(dependencies.auth, config));
  if (dependencies.localStorage && dependencies.documents) {
    v1.use(
      '/storage',
      limit(
        'document-download',
        config.UPLOAD_RATE_LIMIT_MAX,
        'ip',
        'Demasiadas descargas; espera un momento',
      ),
      createLocalStorageRouter(dependencies.localStorage, dependencies.documents),
    );
  }

  const authenticated = Router();
  authenticated.use(requireAuth(dependencies.auth, config.COOKIE_NAME));
  authenticated.use(protectMutations(config.COOKIE_NAME));
  const userLimit = (name: string, max: number, message: string): RequestHandler =>
    limit(name, max, 'user', message);
  authenticated.use(
    '/groups',
    createGroupsRouter(dependencies.groups, {
      invitations: userLimit(
        'invitations',
        config.INVITATION_RATE_LIMIT_MAX,
        'Demasiadas invitaciones; espera un momento',
      ),
    }),
  );
  authenticated.use(
    '/groups/:groupId/events',
    createEventsRouter(dependencies.events, {
      rsvpLimit: userLimit(
        'event-rsvp',
        config.EVENT_RSVP_RATE_LIMIT_MAX,
        'Demasiadas respuestas RSVP',
      ),
    }),
  );
  authenticated.use(
    '/groups/:groupId/expenses',
    createExpensesRouter(
      dependencies.expenses,
      userLimit('expenses', config.EXPENSE_RATE_LIMIT_MAX, 'Demasiados gastos; espera un momento'),
    ),
  );
  authenticated.use(
    '/groups/:groupId/settlements',
    createSettlementsRouter(dependencies.settlements),
  );
  if (dependencies.funds)
    authenticated.use('/groups/:groupId/funds', createFundsRouter(dependencies.funds));
  if (dependencies.budgets)
    authenticated.use('/groups/:groupId/budgets', createBudgetsRouter(dependencies.budgets));
  if (dependencies.privacy) {
    authenticated.use(
      '/privacy',
      createPrivacyRouter(
        dependencies.privacy,
        config,
        userLimit('privacy', config.PRIVACY_RATE_LIMIT_MAX, 'Demasiadas solicitudes de privacidad'),
      ),
    );
  }
  if (dependencies.documents) {
    authenticated.use(
      '/documents',
      createDocumentsRouter(dependencies.documents, {
        maxBytes: config.MAX_UPLOAD_BYTES,
        uploadLimit: userLimit(
          'uploads',
          config.UPLOAD_RATE_LIMIT_MAX,
          'Demasiadas subidas; espera un momento',
        ),
        downloadUrlLimit: userLimit(
          'document-download-url',
          config.UPLOAD_RATE_LIMIT_MAX,
          'Demasiadas solicitudes de descarga; espera un momento',
        ),
      }),
    );
  }
  if (dependencies.ocr) {
    authenticated.use(
      '/ocr',
      createOcrRouter(
        dependencies.ocr,
        userLimit('ocr', config.OCR_RATE_LIMIT_MAX, 'Demasiados trabajos OCR'),
      ),
    );
  }
  if (dependencies.cabudas)
    authenticated.use('/cabudas', createCabudasRouter(dependencies.cabudas));
  if (dependencies.statistics)
    authenticated.use(
      '/statistics',
      createStatisticsRouter(
        dependencies.statistics,
        userLimit(
          'statistics-export',
          config.STATISTICS_EXPORT_RATE_LIMIT_MAX,
          'Demasiadas exportaciones de estadisticas',
        ),
        config.STATISTICS_EXPORT_MAX_ROWS,
      ),
    );
  if (dependencies.notifications) {
    const pushSubscriptionLimit = userLimit(
      'push-subscriptions',
      config.PUSH_SUBSCRIPTION_RATE_LIMIT_MAX,
      'Demasiadas suscripciones push; espera un momento',
    );
    authenticated.post('/notifications/push-subscriptions', pushSubscriptionLimit);
    authenticated.delete('/notifications/push-subscriptions', pushSubscriptionLimit);
    authenticated.use('/notifications', createNotificationsRouter(dependencies.notifications));
  }
  if (dependencies.achievements)
    authenticated.use('/achievements', createAchievementsRouter(dependencies.achievements));
  v1.use(authenticated);
  app.use('/api/v1', v1);
  app.use(notFound);
  app.use(errorHandler(logger));
  return app;
}
