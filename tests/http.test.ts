import type { GroupRole } from '@prisma/client';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';
import { createApp } from '../src/http/app.js';
import type { AuthContext, AuthPort, SessionResult } from '../src/modules/auth/auth.service.js';
import type { EventsService } from '../src/modules/events/events.service.js';
import type { ExpensesService } from '../src/modules/expenses/expenses.service.js';
import type { GroupsService } from '../src/modules/groups/groups.service.js';
import type { SettlementsService } from '../src/modules/settlements/settlements.service.js';
import { hashToken } from '../src/shared/crypto.js';

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  displayName: 'Ana',
  avatarUrl: null,
};
const session: SessionResult = {
  user,
  sessionToken: 'session-token',
  csrfToken: 'csrf-token',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

function fixture(ready = true, env: Record<string, string> = {}) {
  const auth: AuthPort = {
    register: vi.fn(async () => session),
    login: vi.fn(async () => session),
    authenticate: vi.fn(async (): Promise<AuthContext> => ({
      user,
      userId: user.id,
      sessionId: '20000000-0000-4000-8000-000000000001',
      csrfTokenHash: hashToken(session.csrfToken),
    })),
    logout: vi.fn(async () => undefined),
  };
  const groups = {
    create: vi.fn(),
    requireRole: vi.fn(async () => ({
      id: 'member',
      groupId: 'group',
      userId: user.id,
      role: 'MEMBER' as GroupRole,
    })),
  } as unknown as GroupsService;
  const config = loadConfig({
    NODE_ENV: 'test',
    DATABASE_URL: 'postgresql://fake:fake@localhost:5432/fake',
    CORS_ORIGINS: 'http://localhost:5173',
    COOKIE_NAME: 'cabales_session',
    ...env,
  });
  return {
    app: createApp({
      config,
      logger: createLogger('silent'),
      auth,
      groups,
      events: {} as EventsService,
      expenses: {} as ExpensesService,
      settlements: {} as SettlementsService,
      readiness: vi.fn(async () => ready),
    }),
    auth,
  };
}

describe('HTTP transversal', () => {
  it('expone health y propaga request ID', async () => {
    const response = await request(fixture().app).get('/health').set('X-Request-Id', 'corr-123');
    expect(response.status).toBe(200);
    expect(response.headers['x-request-id']).toBe('corr-123');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.body).toEqual({ success: true, data: { status: 'up' } });
  });

  it('ready falla de forma controlada sin PostgreSQL', async () => {
    const response = await request(fixture(false).app).get('/ready');
    expect(response.status).toBe(503);
    expect(response.body.error).toMatchObject({ code: 'NOT_READY' });
    expect(response.body.error.requestId).toBeTruthy();
  });

  it('normaliza 404 al sobre de error', async () => {
    const response = await request(fixture().app).get('/desconocida');
    expect(response.status).toBe(404);
    expect(response.body).toMatchObject({ success: false, error: { code: 'NOT_FOUND' } });
  });

  it('clasifica JSON malformado como error de cliente', async () => {
    const response = await request(fixture().app)
      .post('/api/v1/auth/login')
      .set('Content-Type', 'application/json')
      .send('{');
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('INVALID_JSON');
  });
});

describe('HTTP auth aislado', () => {
  it('valida el registro antes de llamar al servicio', async () => {
    const { app, auth } = fixture();
    const response = await request(app)
      .post('/api/v1/auth/register')
      .send({ email: 'no-es-email', password: 'corta' });
    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(auth.register).not.toHaveBeenCalled();
  });

  it('login emite cookies con HttpOnly solo para sesion', async () => {
    const response = await request(fixture().app)
      .post('/api/v1/auth/login')
      .send({ email: 'ANA@example.com', password: 'una-clave-segura-123' });
    expect(response.status).toBe(200);
    expect(response.body.data.user.email).toBe(user.email);
    expect(response.headers['cache-control']).toBe('private, no-store');
    const cookies = response.headers['set-cookie'] as unknown as string[];
    expect(
      cookies.some((cookie) => cookie.includes('cabales_session=') && cookie.includes('HttpOnly')),
    ).toBe(true);
    expect(
      cookies.some(
        (cookie) => cookie.includes('cabales_session_csrf=') && !cookie.includes('HttpOnly'),
      ),
    ).toBe(true);
  });

  it('rechaza mutacion autenticada sin CSRF', async () => {
    const response = await request(fixture().app)
      .post('/api/v1/groups')
      .set('Cookie', 'cabales_session=session-token')
      .send({ name: 'Viaje', currency: 'USD' });
    expect(response.status).toBe(403);
    expect(response.body.error.code).toBe('CSRF_INVALID');
  });

  it('/me recupera solo el token CSRF de cookie que coincide con la sesión', async () => {
    const valid = await request(fixture().app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cabales_session=session-token', 'cabales_session_csrf=csrf-token']);
    expect(valid.status).toBe(200);
    expect(valid.body.data).toMatchObject({ user, csrfToken: 'csrf-token' });
    expect(valid.headers['cache-control']).toBe('private, no-store');

    const invalid = await request(fixture().app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cabales_session=session-token', 'cabales_session_csrf=token-adulterado']);
    expect(invalid.status).toBe(403);
    expect(invalid.body.error.code).toBe('CSRF_INVALID');
  });

  it('aplica el límite estricto a login/register pero no a /me', async () => {
    const { app } = fixture(true, { AUTH_RATE_LIMIT_MAX: '1' });
    const credentials = { email: 'ana@example.com', password: 'una-clave-segura-123' };
    expect((await request(app).post('/api/v1/auth/login').send(credentials)).status).toBe(200);
    expect((await request(app).post('/api/v1/auth/login').send(credentials)).status).toBe(429);

    const me = await request(app)
      .get('/api/v1/auth/me')
      .set('Cookie', ['cabales_session=session-token', 'cabales_session_csrf=csrf-token']);
    expect(me.status).toBe(200);
  });
});
