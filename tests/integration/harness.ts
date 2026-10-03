import { mkdtemp } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { loadConfig } from '../../src/config/env.js';
import { createLogger } from '../../src/config/logger.js';
import { createContainer, type ContainerOverrides } from '../../src/composition.js';
import type { EmailMessage, EmailProvider } from '../../src/infrastructure/email.js';

/** URL de PostgreSQL exclusiva para pruebas; nunca se usa DATABASE_URL para evitar borrar datos reales. */
export const TEST_DATABASE_URL = process.env['TEST_DATABASE_URL'];
export const TEST_REDIS_URL = process.env['TEST_REDIS_URL'];

/** Captura correos para leer enlaces de verificación, recuperación e invitación. */
export class CaptureEmailProvider implements EmailProvider {
  readonly name = 'capture';
  readonly sent: EmailMessage[] = [];
  async send(message: EmailMessage) {
    this.sent.push(message);
  }
  lastTokenFor(to: string, subjectPart: string): string {
    const message = [...this.sent]
      .reverse()
      .find((item) => item.to === to && item.subject.includes(subjectPart));
    const token = message?.text.match(/#token=([A-Za-z0-9_-]+)/)?.[1];
    if (!token) throw new Error(`Sin correo "${subjectPart}" para ${to}`);
    return token;
  }
}

export async function createTestContainer(
  env: Record<string, string> = {},
  overrides: ContainerOverrides = {},
) {
  if (!TEST_DATABASE_URL) throw new Error('TEST_DATABASE_URL requerido');
  const storageDir = await mkdtemp(path.join(os.tmpdir(), 'cabales-it-'));
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: TEST_DATABASE_URL,
    STORAGE_LOCAL_DIR: storageDir,
    STORAGE_SIGNING_SECRET: 'integration-signing-secret-0123456789',
    PUBLIC_API_ORIGIN: 'http://api.test',
    RATE_LIMIT_MAX: '100000',
    AUTH_RATE_LIMIT_MAX: '100000',
    RECOVERY_RATE_LIMIT_MAX: '100000',
    LOG_LEVEL: 'silent',
    ...env,
  });
  const email = new CaptureEmailProvider();
  const container = createContainer(config, createLogger('silent'), { email, ...overrides });
  return { ...container, config, email: overrides.email ?? email, capture: email };
}

/** Borra todas las tablas de la base de pruebas; se niega si el nombre no contiene "test". */
export async function resetDatabase(db: ReturnType<typeof createContainer>['db']) {
  const url = new URL(TEST_DATABASE_URL!);
  if (!/test/i.test(url.pathname))
    throw new Error('Negado: la base de pruebas debe contener "test" en su nombre');
  const tables = await db.$queryRawUnsafe<Array<{ tablename: string }>>(
    `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`,
  );
  if (tables.length === 0) return;
  await db.$executeRawUnsafe(
    `TRUNCATE ${tables.map((table) => `"${table.tablename}"`).join(', ')} CASCADE`,
  );
}

/** Cliente con cookies y CSRF, como la PWA. */
export class Client {
  csrf = '';
  readonly agent;
  constructor(app: Parameters<typeof request.agent>[0]) {
    this.agent = request.agent(app);
  }
  private capture(response: request.Response) {
    const token = response.body?.data?.csrfToken;
    if (typeof token === 'string') this.csrf = token;
    return response;
  }
  async register(email: string, displayName: string, password = 'una-clave-segura-123') {
    return this.capture(
      await this.agent.post('/api/v1/auth/register').send({ email, password, displayName }),
    );
  }
  async login(email: string, password = 'una-clave-segura-123') {
    return this.capture(await this.agent.post('/api/v1/auth/login').send({ email, password }));
  }
  get(path: string) {
    return this.agent.get(`/api/v1${path}`);
  }
  post(path: string, body?: unknown, headers: Record<string, string> = {}) {
    const req = this.agent.post(`/api/v1${path}`).set('X-CSRF-Token', this.csrf).set(headers);
    return body === undefined ? req : req.send(body as object);
  }
  patch(path: string, body?: unknown) {
    return this.agent
      .patch(`/api/v1${path}`)
      .set('X-CSRF-Token', this.csrf)
      .send((body ?? {}) as object);
  }
  put(path: string, body: unknown) {
    return this.agent
      .put(`/api/v1${path}`)
      .set('X-CSRF-Token', this.csrf)
      .send(body as object);
  }
  delete(path: string, body?: unknown) {
    const req = this.agent.delete(`/api/v1${path}`).set('X-CSRF-Token', this.csrf);
    return body === undefined ? req : req.send(body as object);
  }
}

/** PNG mínimo válido (1x1) para subir documentos reales. */
export const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
  'base64',
);
