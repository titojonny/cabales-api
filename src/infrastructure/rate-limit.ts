import type { Request } from 'express';
import {
  rateLimit,
  ipKeyGenerator,
  type ClientRateLimitInfo,
  type Options,
  type Store,
} from 'express-rate-limit';
import { Redis } from 'ioredis';
import { hashToken } from '../shared/crypto.js';
import { AppError } from '../shared/errors.js';

/** Script atómico: incrementa y fija la ventana solo en el primer impacto. */
const INCREMENT_SCRIPT = `
local hits = redis.call('INCR', KEYS[1])
local ttl = redis.call('PTTL', KEYS[1])
if ttl < 0 then
  redis.call('PEXPIRE', KEYS[1], ARGV[1])
  ttl = tonumber(ARGV[1])
end
return {hits, ttl}
`;

/** Cliente mínimo requerido por el store; permite dobles en pruebas. */
export interface RedisLike {
  eval(script: string, numKeys: number, ...args: Array<string | number>): Promise<unknown>;
  decr(key: string): Promise<number>;
  del(key: string): Promise<number>;
}

/** Store distribuido de express-rate-limit sobre Redis; comparte contadores entre instancias. */
export class RedisRateLimitStore implements Store {
  windowMs = 60_000;
  readonly localKeys = false;

  constructor(
    private readonly client: RedisLike,
    readonly prefix: string,
  ) {}

  init(options: Options): void {
    this.windowMs = options.windowMs;
  }

  private key(key: string) {
    return `cabales:rl:${this.prefix}:${key}`;
  }

  async increment(key: string): Promise<ClientRateLimitInfo> {
    try {
      const result = (await this.client.eval(
        INCREMENT_SCRIPT,
        1,
        this.key(key),
        this.windowMs,
      )) as [number, number];
      const [hits, ttl] = result.map(Number) as [number, number];
      return { totalHits: hits, resetTime: new Date(Date.now() + ttl) };
    } catch {
      throw new AppError(
        503,
        'RATE_LIMIT_UNAVAILABLE',
        'El control de solicitudes no esta disponible',
      );
    }
  }

  async decrement(key: string): Promise<void> {
    await this.client.decr(this.key(key)).catch(() => undefined);
  }

  async resetKey(key: string): Promise<void> {
    await this.client.del(this.key(key)).catch(() => undefined);
  }
}

/** Fábrica de stores: memoria (un proceso) o Redis compartido. */
export interface RateLimitStoreFactory {
  readonly kind: 'memory' | 'redis';
  create(prefix: string): Store | undefined;
  close(): Promise<void>;
}

export function createRateLimitStoreFactory(
  kind: 'memory' | 'redis',
  redisUrl?: string,
  client?: RedisLike,
): RateLimitStoreFactory {
  if (kind === 'memory') {
    return { kind, create: () => undefined, close: async () => undefined };
  }
  const redis =
    client ??
    new Redis(redisUrl!, {
      // La cola offline permite atender las primeras peticiones mientras conecta;
      // commandTimeout y maxRetriesPerRequest acotan la espera si Redis cae (falla cerrada).
      maxRetriesPerRequest: 1,
      enableOfflineQueue: true,
      connectTimeout: 2000,
      commandTimeout: 1000,
      lazyConnect: false,
    });
  if (redis instanceof Redis) redis.on('error', () => undefined);
  return {
    kind,
    create: (prefix) => new RedisRateLimitStore(redis, prefix),
    close: async () => {
      if (redis instanceof Redis) await redis.quit().catch(() => undefined);
    },
  };
}

/** Correo normalizado del cuerpo, reducido a hash para no guardar datos personales en Redis. */
export function emailKey(req: Request): string | undefined {
  const email = (req.body as { email?: unknown } | undefined)?.email;
  if (typeof email !== 'string') return undefined;
  const normalized = email.trim().toLowerCase();
  return normalized.length > 0 && normalized.length <= 320 ? hashToken(normalized) : undefined;
}

export type LimiterKey = 'ip' | 'user' | 'email';

/** Crea un limitador con respuesta 429 en el sobre estándar y Retry-After. */
export function createLimiter(options: {
  name: string;
  max: number;
  windowMs: number;
  key: LimiterKey;
  stores: RateLimitStoreFactory;
  message: string;
  /** Solo el limitador global deja pasar si Redis falla; los sensibles fallan cerrados. */
  failOpen?: boolean;
}) {
  const store = options.stores.create(options.name);
  return rateLimit({
    windowMs: options.windowMs,
    limit: options.max,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    passOnStoreError: options.failOpen ?? false,
    ...(store ? { store } : {}),
    skip: (req) => options.key === 'email' && !emailKey(req),
    keyGenerator: (req) => {
      const endpoint = `${req.baseUrl}${req.path}`;
      if (options.key === 'user' && req.auth?.userId) return `u:${req.auth.userId}`;
      if (options.key === 'email') return `e:${endpoint}:${emailKey(req)}`;
      return `ip:${ipKeyGenerator(req.ip ?? '0.0.0.0')}`;
    },
    handler: (req, res) => {
      if (!res.hasHeader('Retry-After')) {
        const reset = (req as Request & { rateLimit?: { resetTime?: Date } }).rateLimit?.resetTime;
        const seconds = reset ? Math.max(1, Math.ceil((reset.getTime() - Date.now()) / 1000)) : 60;
        res.setHeader('Retry-After', String(seconds));
      }
      res.setHeader('Cache-Control', 'no-store');
      res.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: options.message, requestId: req.requestId },
      });
    },
  });
}
