import { Prisma } from '@prisma/client';
import type { AppConfig } from './config/env.js';
import type { AppLogger } from './config/logger.js';
import { createDatabase, type Database } from './database/client.js';
import { createApp } from './http/app.js';
import { BackgroundTasks } from './infrastructure/background.js';
import {
  HttpEmailProvider,
  LoggingEmailProvider,
  type EmailProvider,
} from './infrastructure/email.js';
import {
  DisabledOcrProvider,
  HttpOcrProvider,
  LocalOcrProvider,
  TesseractOcrProvider,
  type OcrProvider,
} from './infrastructure/ocr.js';
import {
  DisabledPushProvider,
  WebPushProvider,
  type NotificationPushProvider,
} from './infrastructure/push.js';
import {
  createRateLimitStoreFactory,
  type RateLimitStoreFactory,
} from './infrastructure/rate-limit.js';
import {
  PostgresAdvisoryLock,
  PrismaJobExecutionStore,
  TaskScheduler,
} from './infrastructure/scheduler.js';
import {
  LocalFileStorageProvider,
  S3FileStorageProvider,
  type FileStorageProvider,
} from './infrastructure/storage.js';
import { GoogleOAuthClient } from './infrastructure/google-oauth.js';
import { DocumentEncryption } from './modules/documents/document-encryption.js';
import { DocumentLockService } from './modules/documents/document-lock.service.js';
import { AchievementsService } from './modules/achievements/achievements.service.js';
import { AuthRepository } from './modules/auth/auth.repository.js';
import { AuthService } from './modules/auth/auth.service.js';
import { BudgetsRepository } from './modules/budgets/budgets.repository.js';
import { BudgetsService } from './modules/budgets/budgets.service.js';
import { CabudasService } from './modules/cabudas/cabudas.service.js';
import { PersonalCategoriesService } from './modules/categories/categories.service.js';
import { DocumentsRepository } from './modules/documents/documents.repository.js';
import { DocumentsService } from './modules/documents/documents.service.js';
import { EventsRepository } from './modules/events/events.repository.js';
import { EventsService } from './modules/events/events.service.js';
import { EventRemindersService } from './modules/events/event-reminders.service.js';
import { ExpensesRepository } from './modules/expenses/expenses.repository.js';
import { ExpensesService } from './modules/expenses/expenses.service.js';
import { PersonalExpensesService } from './modules/expenses/personal-expenses.service.js';
import { FundsRepository } from './modules/funds/funds.repository.js';
import { FundsService } from './modules/funds/funds.service.js';
import { GroupsRepository } from './modules/groups/groups.repository.js';
import { GroupsService } from './modules/groups/groups.service.js';
import { NotificationsService } from './modules/notifications/notifications.service.js';
import { IncomesRepository } from './modules/incomes/incomes.repository.js';
import { IncomesService } from './modules/incomes/incomes.service.js';
import { OcrRepository } from './modules/ocr/ocr.repository.js';
import { OcrService } from './modules/ocr/ocr.service.js';
import { PrivacyRepository } from './modules/privacy/privacy.repository.js';
import { PrivacyService } from './modules/privacy/privacy.service.js';
import { SettlementsRepository } from './modules/settlements/settlements.repository.js';
import { SettlementsService } from './modules/settlements/settlements.service.js';
import { StatisticsService } from './modules/statistics/statistics.service.js';
import { RecurringExpensesService } from './modules/recurring-expenses/recurring-expenses.service.js';
import { TagsService } from './modules/tags/tags.service.js';
import { DomainEvents } from './shared/events.js';

/** Sustituciones para pruebas (dobles de proveedores externos o base de datos compartida). */
export interface ContainerOverrides {
  db?: Database;
  email?: EmailProvider;
  ocr?: OcrProvider;
  push?: NotificationPushProvider;
  rateLimitStores?: RateLimitStoreFactory;
}

/** Composición única de infraestructura, servicios y HTTP; la usan el servidor y las pruebas. */
export function createContainer(
  config: AppConfig,
  logger: AppLogger,
  overrides: ContainerOverrides = {},
) {
  const db = overrides.db ?? createDatabase(config.DATABASE_URL);
  const background = new BackgroundTasks(logger);
  const domainEvents = new DomainEvents(background);
  const email: EmailProvider =
    overrides.email ??
    (config.EMAIL_PROVIDER === 'http'
      ? new HttpEmailProvider({
          url: config.EMAIL_HTTP_URL!,
          apiKey: config.EMAIL_HTTP_API_KEY!,
          from: config.EMAIL_FROM,
          timeoutMs: config.EXTERNAL_TIMEOUT_MS,
        })
      : new LoggingEmailProvider((entry) =>
          logger.info({ email: entry }, 'Correo local suprimido'),
        ));
  const ocrProvider: OcrProvider =
    overrides.ocr ??
    (config.OCR_PROVIDER === 'http'
      ? new HttpOcrProvider({
          url: config.OCR_HTTP_URL!,
          timeoutMs: config.EXTERNAL_TIMEOUT_MS,
          ...(config.OCR_HTTP_API_KEY ? { apiKey: config.OCR_HTTP_API_KEY } : {}),
        })
      : config.OCR_PROVIDER === 'local'
        ? new LocalOcrProvider()
        : config.OCR_PROVIDER === 'tesseract'
          ? new TesseractOcrProvider({
              langs: config.OCR_TESSERACT_LANGS,
              ...(config.OCR_TESSERACT_LANG_PATH
                ? { langPath: config.OCR_TESSERACT_LANG_PATH }
                : {}),
            })
          : new DisabledOcrProvider());
  const storage: FileStorageProvider =
    config.STORAGE_PROVIDER === 's3'
      ? new S3FileStorageProvider({
          endpoint: config.S3_ENDPOINT!,
          region: config.S3_REGION!,
          bucket: config.S3_BUCKET!,
          accessKeyId: config.S3_ACCESS_KEY_ID!,
          secretAccessKey: config.S3_SECRET_ACCESS_KEY!,
          forcePathStyle: config.S3_FORCE_PATH_STYLE ?? false,
          timeoutMs: config.EXTERNAL_TIMEOUT_MS,
          ...(config.S3_SSE ? { serverSideEncryption: config.S3_SSE } : {}),
          ...(config.S3_SSE_KMS_KEY_ID ? { kmsKeyId: config.S3_SSE_KMS_KEY_ID } : {}),
        })
      : new LocalFileStorageProvider(
          config.STORAGE_LOCAL_DIR,
          config.storageSigningSecret,
          config.PUBLIC_API_ORIGIN,
        );
  const push: NotificationPushProvider =
    overrides.push ??
    (config.PUSH_PROVIDER === 'webpush'
      ? new WebPushProvider({
          publicKey: config.VAPID_PUBLIC_KEY!,
          privateKey: config.VAPID_PRIVATE_KEY!,
          subject: config.VAPID_SUBJECT!,
          timeoutMs: config.EXTERNAL_TIMEOUT_MS,
          logger,
        })
      : new DisabledPushProvider());
  const rateLimitStores =
    overrides.rateLimitStores ??
    createRateLimitStoreFactory(config.RATE_LIMIT_STORE, config.REDIS_URL);

  const groups = new GroupsService(new GroupsRepository(db), {
    email,
    background,
    events: domainEvents,
    appOrigin: config.APP_ORIGIN,
    invitationTtlMs: config.invitationTtlMs,
  });
  const auth = new AuthService(
    new AuthRepository(db),
    {
      sessionTtlMs: config.sessionTtlMs,
      emailVerificationTtlMs: config.emailVerificationTtlMs,
      passwordResetTtlMs: config.passwordResetTtlMs,
      googleStateTtlMs: 10 * 60 * 1000,
      appOrigin: config.APP_ORIGIN,
    },
    email,
    background,
    config.googleEnabled
      ? new GoogleOAuthClient({
          clientId: config.GOOGLE_CLIENT_ID!,
          clientSecret: config.GOOGLE_CLIENT_SECRET!,
          redirectUri: config.GOOGLE_REDIRECT_URI!,
          timeoutMs: config.EXTERNAL_TIMEOUT_MS,
        })
      : undefined,
  );
  const eventsRepository = new EventsRepository(db);
  const events = new EventsService(eventsRepository, groups, domainEvents);
  const tags = new TagsService(db, groups);
  const personalCategories = new PersonalCategoriesService(db);
  const expenses = new ExpensesService(new ExpensesRepository(db), groups, domainEvents);
  const personalExpenses = new PersonalExpensesService(db, domainEvents);
  const settlements = new SettlementsService(new SettlementsRepository(db), groups, domainEvents);
  const budgetsRepository = new BudgetsRepository(db);
  const budgets = new BudgetsService(budgetsRepository, groups);
  const documents = new DocumentsService(new DocumentsRepository(db), groups, storage, {
    maxBytes: config.MAX_UPLOAD_BYTES,
    signedUrlTtlSeconds: config.SIGNED_URL_TTL_SECONDS,
    encryption: new DocumentEncryption(
      config.documentEncryptionKeys,
      config.documentEncryptionActiveKeyId,
    ),
    requireEncryption: config.isProduction,
    publicApiOrigin: config.PUBLIC_API_ORIGIN,
    publicShareOrigin: config.APP_ORIGIN,
    ...(config.S3_SSE ? { s3Sse: config.S3_SSE } : {}),
    ...(config.S3_SSE_KMS_KEY_ID ? { s3SseKmsKeyId: config.S3_SSE_KMS_KEY_ID } : {}),
  });
  const documentLock = new DocumentLockService(db, auth, {
    unlockTtlMs: config.documentLockUnlockMs,
    pinLockMs: config.documentLockPinLockMs,
    maxPinAttempts: config.DOCUMENT_LOCK_PIN_MAX_ATTEMPTS,
    rpId: config.webauthnRpId,
    origin: config.webauthnOrigin,
  });
  const notifications = new NotificationsService(db, {
    email,
    push,
    appOrigin: config.APP_ORIGIN,
    budgets,
  });
  const recurringExpenses = new RecurringExpensesService(db, groups, notifications, domainEvents);
  const eventReminders = new EventRemindersService(eventsRepository, notifications);
  const scheduler = new TaskScheduler({
    enabled: config.SCHEDULER_ENABLED,
    store: new PrismaJobExecutionStore(db),
    lock: rateLimitStores.schedulerLock ?? new PostgresAdvisoryLock(db),
    logger,
    defaultMaxAttempts: config.SCHEDULER_MAX_ATTEMPTS,
    lockTtlMs: config.SCHEDULER_LOCK_TTL_SECONDS * 1000,
  });
  scheduler.register({
    name: 'event-reminders',
    intervalMs: config.SCHEDULER_INTERVAL_SECONDS * 1000,
    lockTtlMs: config.SCHEDULER_LOCK_TTL_SECONDS * 1000,
    run: ({ now }) => eventReminders.run(now),
  });
  scheduler.register({
    name: 'recurring-expenses',
    intervalMs: config.SCHEDULER_INTERVAL_SECONDS * 1000,
    lockTtlMs: config.SCHEDULER_LOCK_TTL_SECONDS * 1000,
    run: ({ now }) => recurringExpenses.runDue(now),
  });
  scheduler.register({
    name: 'document-expiry-notifications',
    intervalMs: config.SCHEDULER_INTERVAL_SECONDS * 1000,
    lockTtlMs: config.SCHEDULER_LOCK_TTL_SECONDS * 1000,
    run: ({ now }) => documents.runExpiryNotifications(now, notifications),
  });
  const achievements = new AchievementsService(db, notifications);
  domainEvents.subscribe((event) => notifications.handle(event));
  domainEvents.subscribe((event) => achievements.handle(event));

  const app = createApp({
    config,
    logger,
    auth,
    groups,
    events,
    expenses,
    personalExpenses,
    personalCategories,
    recurringExpenses,
    tags,
    settlements,
    rateLimitStores,
    privacy: new PrivacyService(new PrivacyRepository(db), auth, {
      exportTtlMs: config.privacyExportTtlMs,
      storage,
      background,
      events: domainEvents,
    }),
    documents,
    documentLock,
    ...(storage instanceof LocalFileStorageProvider ? { localStorage: storage } : {}),
    ocr: new OcrService(new OcrRepository(db), documents, groups, ocrProvider, background, {
      maxAttempts: config.OCR_MAX_ATTEMPTS,
      events: domainEvents,
    }),
    funds: new FundsService(new FundsRepository(db), groups, domainEvents),
    budgets,
    cabudas: new CabudasService(db),
    statistics: new StatisticsService(db, budgets, budgetsRepository),
    incomes: new IncomesService(new IncomesRepository(db)),
    notifications,
    achievements,
    readiness: async () => {
      try {
        await db.$queryRaw(Prisma.sql`SELECT 1`);
        return true;
      } catch {
        return false;
      }
    },
  });

  return {
    app,
    db,
    background,
    scheduler,
    rateLimitStores,
    storage,
    email,
    ocrProvider,
    push,
  };
}
