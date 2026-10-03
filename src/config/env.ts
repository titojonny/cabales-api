import 'dotenv/config';
import { z } from 'zod';

const positiveInt = z.coerce.number().int().positive();
const optionalUrl = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().url().optional(),
);
const optionalSecret = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(16).max(4096).optional(),
);
const optionalString = z.preprocess(
  (value) => (value === '' ? undefined : value),
  z.string().min(1).max(4096).optional(),
);
const optionalBoolean = z.preprocess((value) => {
  if (value === '' || value === undefined) return undefined;
  if (value === true || value === false) return value;
  if (value === 'true') return true;
  if (value === 'false') return false;
  return value;
}, z.boolean().optional());

// Modelos oficiales frecuentes de tessdata. Los modelos personalizados se habilitan con
// OCR_TESSERACT_LANG_PATH, sin permitir códigos desconocidos por accidente.
const knownTesseractLanguages = new Set(
  'afr amh ara asm aze bel ben bod bos bre bul cat ceb ces chi_sim chi_sim_vert chi_tra chi_tra_vert chr cos cym dan deu div dzo ell enm eng epo est eus fas fil fin fra frk frm frr gla gle glg grc guj hat heb hin hrv hun hye iku ind isl ita ita_old jav jpn jpn_vert kan kat kat_old kaz khm kir kmr kor kor_vert lao lat lav lit ltz mal mar mkd mlt mon mri msa mya nep nld nor oci ori osd pan pol por pus que ron rus san sin slk slv snd spa spa_old sqi srp srp_latn sun swa swe syr tam tat tel tgk tha tir ton tur uig ukr urd uzb uzb_cyrl vie yid yor'.split(
    ' ',
  ),
);

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://127.0.0.1:5173'),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 365)
    .default(168),
  COOKIE_NAME: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/)
    .default('cabales_session'),
  // Límites de tasa: memoria solo para desarrollo/pruebas; producción exige Redis compartido.
  RATE_LIMIT_STORE: z.enum(['memory', 'redis']).default('memory'),
  REDIS_URL: optionalUrl,
  RATE_LIMIT_WINDOW_MINUTES: z.coerce.number().int().min(1).max(1440).default(15),
  RATE_LIMIT_MAX: positiveInt.default(300),
  SCHEDULER_ENABLED: optionalBoolean.default(true),
  SCHEDULER_INTERVAL_SECONDS: z.coerce.number().int().min(1).max(3600).default(30),
  SCHEDULER_LOCK_TTL_SECONDS: z.coerce.number().int().min(5).max(3600).default(120),
  SCHEDULER_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  AUTH_RATE_LIMIT_MAX: positiveInt.default(10),
  RECOVERY_RATE_LIMIT_MAX: positiveInt.default(5),
  INVITATION_RATE_LIMIT_MAX: positiveInt.default(30),
  UPLOAD_RATE_LIMIT_MAX: positiveInt.default(30),
  SHARED_LINK_RATE_LIMIT_MAX: positiveInt.default(60),
  DOCUMENT_PIN_RATE_LIMIT_MAX: positiveInt.default(10),
  OCR_RATE_LIMIT_MAX: positiveInt.default(20),
  EXPENSE_RATE_LIMIT_MAX: positiveInt.default(60),
  EVENT_RSVP_RATE_LIMIT_MAX: positiveInt.default(30),
  PRIVACY_RATE_LIMIT_MAX: positiveInt.default(10),
  PUSH_SUBSCRIPTION_RATE_LIMIT_MAX: positiveInt.default(20),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  PASSWORD_RESET_TTL_MINUTES: z.coerce.number().int().min(5).max(120).default(30),
  INVITATION_TTL_DAYS: z.coerce.number().int().min(1).max(30).default(7),
  APP_ORIGIN: z.string().url().default('http://localhost:5173'),
  PUBLIC_API_ORIGIN: z.string().url().default('http://localhost:3000'),
  // Correo: logging no envía nada; http usa una API JSON compatible (p. ej. Resend).
  EMAIL_PROVIDER: z.enum(['logging', 'http']).default('logging'),
  EMAIL_FROM: z.string().min(3).max(320).default('Cabales <no-reply@cabales.local>'),
  EMAIL_HTTP_URL: optionalUrl,
  EMAIL_HTTP_API_KEY: optionalSecret,
  EXTERNAL_TIMEOUT_MS: z.coerce.number().int().min(500).max(60_000).default(8000),
  // Documentos: local guarda en disco; Docs sirve las descargas desde la API.
  STORAGE_PROVIDER: z.enum(['local', 's3']).default('local'),
  STORAGE_LOCAL_DIR: z.string().min(1).default('./storage'),
  STORAGE_SIGNING_SECRET: optionalSecret,
  S3_ENDPOINT: optionalUrl,
  S3_REGION: optionalString,
  S3_BUCKET: optionalString,
  S3_ACCESS_KEY_ID: optionalString,
  S3_SECRET_ACCESS_KEY: optionalString,
  S3_FORCE_PATH_STYLE: optionalBoolean,
  S3_SSE: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['AES256', 'aws:kms']).optional(),
  ),
  S3_SSE_KMS_KEY_ID: optionalString,
  SIGNED_URL_TTL_SECONDS: z.coerce.number().int().min(30).max(900).default(300),
  MAX_UPLOAD_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(25 * 1024 * 1024)
    .default(10 * 1024 * 1024),
  // Cifrado en reposo de documentos: anillo id:base64 de claves maestras de 32 bytes.
  DOCUMENT_ENCRYPTION_KEYS: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.string().max(20_000).optional(),
  ),
  DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID: optionalString,
  DOCUMENT_ENCRYPTION_MIGRATE_LEGACY: optionalBoolean.default(false),
  DOCUMENT_LOCK_UNLOCK_MINUTES: z.coerce.number().int().min(1).max(60).default(10),
  DOCUMENT_LOCK_PIN_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(20).default(5),
  DOCUMENT_LOCK_PIN_LOCK_MINUTES: z.coerce.number().int().min(1).max(120).default(15),
  WEBAUTHN_RP_ID: optionalString,
  WEBAUTHN_ORIGIN: optionalUrl,
  // OCR: disabled falla de forma explícita; http delega en un servicio externo.
  OCR_PROVIDER: z.enum(['disabled', 'http', 'local', 'tesseract']).default('disabled'),
  OCR_HTTP_URL: optionalUrl,
  OCR_HTTP_API_KEY: optionalSecret,
  OCR_TESSERACT_LANGS: z
    .string()
    .regex(/^[a-z]{3}(?:_[a-z]{3})?(?:\+[a-z]{3}(?:_[a-z]{3})?)*$/i)
    .max(80)
    .default('spa+eng'),
  OCR_TESSERACT_LANG_PATH: optionalString,
  OCR_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(10).default(3),
  // Push: disabled degrada a notificaciones dentro de la app; webpush usa solo VAPID del entorno.
  PUSH_PROVIDER: z.enum(['disabled', 'webpush']).default('disabled'),
  VAPID_PUBLIC_KEY: optionalString,
  VAPID_PRIVATE_KEY: optionalSecret,
  VAPID_SUBJECT: optionalString,
  STATISTICS_EXPORT_MAX_ROWS: z.coerce.number().int().min(1).max(10_000).default(1000),
  STATISTICS_EXPORT_RATE_LIMIT_MAX: positiveInt.default(10),
  // Privacidad y retención (días). Los valores legales definitivos los decide el responsable.
  PRIVACY_EXPORT_TTL_DAYS: z.coerce.number().int().min(1).max(90).default(7),
  RETENTION_TOKEN_DAYS: z.coerce.number().int().min(1).max(3650).default(7),
  RETENTION_SESSION_DAYS: z.coerce.number().int().min(1).max(3650).default(30),
  RETENTION_INVITATION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  RETENTION_AUDIT_LOG_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  RETENTION_DOCUMENT_LOG_DAYS: z.coerce.number().int().min(30).max(3650).default(365),
  RETENTION_OCR_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
  RETENTION_NOTIFICATION_DAYS: z.coerce.number().int().min(1).max(3650).default(180),
  RETENTION_PRIVACY_REQUEST_DAYS: z.coerce.number().int().min(30).max(3650).default(730),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** Configuración canónica disponible para composición e infraestructura. */
export type AppConfig = ReturnType<typeof loadConfig>;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Valida toda configuración antes de iniciar listeners o conexiones. */
export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Configuracion invalida: ${z.prettifyError(parsed.error)}`);
  }
  const env = parsed.data;
  const isProduction = env.NODE_ENV === 'production';
  function fail(message: string): never {
    throw new Error(`Configuracion invalida: ${message}`);
  }

  const config = {
    ...env,
    corsOrigins: env.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionTtlMs: env.SESSION_TTL_HOURS * 60 * 60 * 1000,
    emailVerificationTtlMs: env.EMAIL_VERIFICATION_TTL_HOURS * 60 * 60 * 1000,
    passwordResetTtlMs: env.PASSWORD_RESET_TTL_MINUTES * 60 * 1000,
    invitationTtlMs: env.INVITATION_TTL_DAYS * DAY_MS,
    rateLimitWindowMs: env.RATE_LIMIT_WINDOW_MINUTES * 60 * 1000,
    privacyExportTtlMs: env.PRIVACY_EXPORT_TTL_DAYS * DAY_MS,
    // En desarrollo se deriva un secreto efímero por proceso: las URLs firmadas caducan al reiniciar.
    storageSigningSecret: env.STORAGE_SIGNING_SECRET ?? `dev-only-${process.pid}-${Date.now()}`,
    retention: {
      tokensMs: env.RETENTION_TOKEN_DAYS * DAY_MS,
      sessionsMs: env.RETENTION_SESSION_DAYS * DAY_MS,
      invitationsMs: env.RETENTION_INVITATION_DAYS * DAY_MS,
      auditLogsMs: env.RETENTION_AUDIT_LOG_DAYS * DAY_MS,
      documentLogsMs: env.RETENTION_DOCUMENT_LOG_DAYS * DAY_MS,
      ocrMs: env.RETENTION_OCR_DAYS * DAY_MS,
      notificationsMs: env.RETENTION_NOTIFICATION_DAYS * DAY_MS,
      privacyRequestsMs: env.RETENTION_PRIVACY_REQUEST_DAYS * DAY_MS,
    },
    isProduction,
    documentEncryptionKeys: parseDocumentEncryptionKeys(env.DOCUMENT_ENCRYPTION_KEYS),
    documentEncryptionActiveKeyId: env.DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID,
    documentLockUnlockMs: env.DOCUMENT_LOCK_UNLOCK_MINUTES * 60 * 1000,
    documentLockPinLockMs: env.DOCUMENT_LOCK_PIN_LOCK_MINUTES * 60 * 1000,
    webauthnRpId: env.WEBAUTHN_RP_ID ?? new URL(env.APP_ORIGIN).hostname,
    webauthnOrigin: env.WEBAUTHN_ORIGIN ?? env.APP_ORIGIN,
  };

  if (
    isProduction &&
    config.corsOrigins.some((origin) =>
      /^(https?:\/\/)(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin),
    )
  ) {
    fail('CORS_ORIGINS de produccion no puede incluir localhost');
  }
  if (config.corsOrigins.includes('*')) fail('CORS_ORIGINS no admite * con cookies');
  if (isProduction && !config.corsOrigins.includes(config.webauthnOrigin))
    fail('WEBAUTHN_ORIGIN debe estar incluido en CORS_ORIGINS en produccion');
  if (env.RATE_LIMIT_STORE === 'redis' && !env.REDIS_URL)
    fail('REDIS_URL es obligatorio con redis');
  if (isProduction && env.RATE_LIMIT_STORE !== 'redis') {
    fail('produccion requiere RATE_LIMIT_STORE=redis para limites distribuidos');
  }
  if (env.EMAIL_PROVIDER === 'http' && (!env.EMAIL_HTTP_URL || !env.EMAIL_HTTP_API_KEY)) {
    fail('EMAIL_PROVIDER=http requiere EMAIL_HTTP_URL y EMAIL_HTTP_API_KEY');
  }
  if (env.OCR_PROVIDER === 'http' && !env.OCR_HTTP_URL)
    fail('OCR_PROVIDER=http requiere OCR_HTTP_URL');
  if (env.OCR_PROVIDER === 'tesseract') {
    const unknownLanguages = env.OCR_TESSERACT_LANGS.split('+').filter(
      (language) => !knownTesseractLanguages.has(language.toLowerCase()),
    );
    if (unknownLanguages.length > 0 && !env.OCR_TESSERACT_LANG_PATH) {
      fail(
        `OCR_TESSERACT_LANGS contiene idiomas desconocidos (${unknownLanguages.join(', ')}); configure OCR_TESSERACT_LANG_PATH para modelos locales`,
      );
    }
  }
  if (env.OCR_PROVIDER === 'local' && isProduction)
    fail(
      'OCR_PROVIDER=local solo para desarrollo y pruebas; produccion debe rechazar datos ficticios',
    );
  if (env.STORAGE_PROVIDER === 's3') {
    if (
      !env.S3_ENDPOINT ||
      !env.S3_REGION ||
      !env.S3_BUCKET ||
      !env.S3_ACCESS_KEY_ID ||
      !env.S3_SECRET_ACCESS_KEY
    ) {
      fail(
        'STORAGE_PROVIDER=s3 requiere S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY',
      );
    }
    if (env.S3_SSE === 'aws:kms' && !env.S3_SSE_KMS_KEY_ID)
      fail('S3_SSE=aws:kms requiere S3_SSE_KMS_KEY_ID');
  }
  if (isProduction && config.documentEncryptionKeys.size === 0)
    fail('produccion requiere DOCUMENT_ENCRYPTION_KEYS con al menos una clave');
  if (config.documentEncryptionKeys.size > 0) {
    if (!config.documentEncryptionActiveKeyId)
      fail('DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID es obligatorio al configurar el anillo');
    if (!config.documentEncryptionKeys.has(config.documentEncryptionActiveKeyId))
      fail('DOCUMENT_ENCRYPTION_ACTIVE_KEY_ID no existe en DOCUMENT_ENCRYPTION_KEYS');
  }
  if (env.PUSH_PROVIDER === 'webpush') {
    const vapidPublicKey = env.VAPID_PUBLIC_KEY;
    const vapidPrivateKey = env.VAPID_PRIVATE_KEY;
    const vapidSubject = env.VAPID_SUBJECT;
    if (
      typeof vapidPublicKey !== 'string' ||
      typeof vapidPrivateKey !== 'string' ||
      typeof vapidSubject !== 'string'
    ) {
      fail('PUSH_PROVIDER=webpush requiere VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY y VAPID_SUBJECT');
    }
    if (
      !/^[A-Za-z0-9_-]{40,200}$/.test(vapidPublicKey) ||
      !/^[A-Za-z0-9_-]{30,200}$/.test(vapidPrivateKey)
    ) {
      fail('VAPID_PUBLIC_KEY y VAPID_PRIVATE_KEY deben ser claves base64url validas');
    }
    if (
      !vapidSubject.startsWith('mailto:') &&
      !/^https:\/\//i.test(vapidSubject) &&
      !(!isProduction && /^http:\/\//i.test(vapidSubject))
    )
      fail('VAPID_SUBJECT debe ser mailto:... o una URL https');
  }
  if (
    isProduction &&
    env.STORAGE_PROVIDER === 'local' &&
    (!env.STORAGE_SIGNING_SECRET || env.STORAGE_SIGNING_SECRET.length < 32)
  ) {
    fail('produccion requiere STORAGE_SIGNING_SECRET de al menos 32 caracteres');
  }
  const warnings: string[] = [];
  if (isProduction && env.EMAIL_PROVIDER === 'logging') {
    warnings.push(
      'EMAIL_PROVIDER=logging en produccion: verificacion, recuperacion e invitaciones no llegaran',
    );
  }
  if (isProduction && env.OCR_PROVIDER === 'disabled') {
    warnings.push('OCR_PROVIDER=disabled: los trabajos OCR fallaran con OCR_PROVIDER_DISABLED');
  }
  if (env.OCR_PROVIDER === 'local') {
    warnings.push(
      'OCR_PROVIDER=local es un adaptador determinista de desarrollo/pruebas; nunca debe usarse con usuarios reales',
    );
  }

  return { ...config, warnings };
}

/** Analiza el anillo sin incluir nunca el material de clave en errores ni logs. */
function parseDocumentEncryptionKeys(value: string | undefined): Map<string, Buffer> {
  const result = new Map<string, Buffer>();
  if (!value) return result;
  for (const entry of value.split(',')) {
    const [id, encoded, extra] = entry.trim().split(':');
    if (!id || !encoded || extra !== undefined || !/^[A-Za-z0-9_-]{1,80}$/.test(id))
      throw new Error('Configuracion invalida: DOCUMENT_ENCRYPTION_KEYS tiene formato invalido');
    const key = Buffer.from(encoded, 'base64');
    if (key.length !== 32)
      throw new Error('Configuracion invalida: cada clave de documentos debe tener 32 bytes');
    if (result.has(id)) throw new Error('Configuracion invalida: id duplicado en el anillo');
    result.set(id, key);
  }
  return result;
}
