import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  DATABASE_URL: z.string().url().startsWith('postgresql://'),
  CORS_ORIGINS: z.string().default('http://localhost:5173'),
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
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(300),
  AUTH_RATE_LIMIT_MAX: z.coerce.number().int().positive().default(10),
  TRUST_PROXY: z.coerce.number().int().min(0).max(10).default(0),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
});

/** Configuración canónica disponible para composición e infraestructura. */
export type AppConfig = ReturnType<typeof loadConfig>;

/** Valida toda configuración antes de iniciar listeners o conexiones. */
export function loadConfig(input: NodeJS.ProcessEnv = process.env) {
  const parsed = envSchema.safeParse(input);
  if (!parsed.success) {
    throw new Error(`Configuracion invalida: ${z.prettifyError(parsed.error)}`);
  }

  return {
    ...parsed.data,
    corsOrigins: parsed.data.CORS_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter(Boolean),
    sessionTtlMs: parsed.data.SESSION_TTL_HOURS * 60 * 60 * 1000,
    isProduction: parsed.data.NODE_ENV === 'production',
  };
}
