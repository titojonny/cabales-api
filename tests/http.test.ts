import type { GroupRole } from '@prisma/client';
import express, { type RequestHandler } from 'express';
import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { loadConfig } from '../src/config/env.js';
import { createLogger } from '../src/config/logger.js';
import { createApp } from '../src/http/app.js';
import { createDocumentsRouter } from '../src/modules/documents/documents.router.js';
import type { DocumentsService } from '../src/modules/documents/documents.service.js';
import type { AuthContext, AuthPort, SessionResult } from '../src/modules/auth/auth.service.js';
import type { EventsService } from '../src/modules/events/events.service.js';
import type { ExpensesService } from '../src/modules/expenses/expenses.service.js';
import { createGroupsRouter } from '../src/modules/groups/groups.router.js';
import type { GroupsService } from '../src/modules/groups/groups.service.js';
import type { NotificationsService } from '../src/modules/notifications/notifications.service.js';
import { createPrivacyRouter } from '../src/modules/privacy/privacy.router.js';
import type { PrivacyService } from '../src/modules/privacy/privacy.service.js';
import type { SettlementsService } from '../src/modules/settlements/settlements.service.js';
import { hashToken } from '../src/shared/crypto.js';

const base = { DATABASE_URL: 'postgresql://fake:fake@localhost:5432/fake' };

const user = {
  id: '10000000-0000-4000-8000-000000000001',
  email: 'ana@example.com',
  displayName: 'Ana',
  avatarUrl: null,
  locale: 'es',
  emailVerified: false,
};
const session: SessionResult = {
  user,
  sessionToken: 'session-token',
  csrfToken: 'csrf-token',
  expiresAt: new Date('2099-01-01T00:00:00.000Z'),
};

function fixture(
  ready = true,
  env: Record<string, string> = {},
  notifications?: NotificationsService,
) {
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
    requestEmailVerification: vi.fn(async () => undefined),
    verifyEmail: vi.fn(async () => user),
    requestPasswordReset: vi.fn(async () => undefined),
    resetPassword: vi.fn(async () => undefined),
    updateProfile: vi.fn(async () => user),
    verifyPassword: vi.fn(async () => true),
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
      ...(notifications ? { notifications } : {}),
      readiness: vi.fn(async () => ready),
    }),
    auth,
  };
}

describe('limites de rutas sensibles', () => {
  it('corta antes del servicio las URLs de descarga y las operaciones ARCO limitadas', async () => {
    const limited: RequestHandler = (_req, res) => {
      res.status(429).json({ success: false, error: { code: 'RATE_LIMITED' } });
    };
    const authMiddleware = (app: ReturnType<typeof express>) => {
      app.use((req, _res, next) => {
        req.auth = { userId: user.id } as AuthContext;
        req.requestId = 'test-request';
        next();
      });
      return app;
    };

    const documents = { downloadUrl: vi.fn() } as unknown as DocumentsService;
    const documentApp = authMiddleware(express());
    documentApp.use(
      '/documents',
      createDocumentsRouter(documents, { maxBytes: 1024, downloadUrlLimit: limited }),
    );
    const documentResponse = await request(documentApp).post(
      '/documents/10000000-0000-4000-8000-000000000001/download-url',
    );
    expect(documentResponse.status).toBe(429);
    expect(documents.downloadUrl).not.toHaveBeenCalled();

    const groups = { previewInvitation: vi.fn() } as unknown as GroupsService;
    const groupsApp = authMiddleware(express());
    groupsApp.use('/groups', createGroupsRouter(groups, { invitations: limited }));
    const invitationResponse = await request(groupsApp)
      .post('/groups/invitations/preview')
      .send({ token: 'x'.repeat(43) });
    expect(invitationResponse.status).toBe(429);
    expect(groups.previewInvitation).not.toHaveBeenCalled();

    const privacy = { cancel: vi.fn() } as unknown as PrivacyService;
    const privacyApp = authMiddleware(express());
    privacyApp.use(
      '/privacy',
      createPrivacyRouter(privacy, loadConfig({ ...base, NODE_ENV: 'test' }), limited),
    );
    const privacyResponse = await request(privacyApp).post(
      '/privacy/requests/20000000-0000-4000-8000-000000000001/cancel',
    );
    expect(privacyResponse.status).toBe(429);
    expect(privacy.cancel).not.toHaveBeenCalled();
  });
});

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

  it('permite el origen de cabales-app y no bloquea el fetch cruzado', async () => {
    const response = await request(fixture().app)
      .options('/api/v1/auth/login')
      .set('Origin', 'http://localhost:5173')
      .set('Access-Control-Request-Method', 'POST')
      .set('Access-Control-Request-Headers', 'content-type,x-csrf-token,x-request-id');
    expect(response.status).toBe(204);
    expect(response.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    expect(response.headers['access-control-allow-credentials']).toBe('true');
    expect(response.headers['cross-origin-resource-policy']).toBe('cross-origin');
  });
});

describe('HTTP recuperación y límites', () => {
  it('responde 202 idéntico exista o no la cuenta (anti-enumeración)', async () => {
    const { app, auth } = fixture();
    const known = await request(app)
      .post('/api/v1/auth/password-recovery/request')
      .send({ email: 'ana@example.com' });
    const unknown = await request(app)
      .post('/api/v1/auth/password-recovery/request')
      .send({ email: 'nadie@example.com' });
    expect(known.status).toBe(202);
    expect(unknown.status).toBe(202);
    expect(known.body.data).toEqual(unknown.body.data);
    expect(auth.requestPasswordReset).toHaveBeenCalledTimes(2);
  });

  it('limita recuperación por correo normalizado con 429, Retry-After y CORS legible', async () => {
    const { app } = fixture(true, { RECOVERY_RATE_LIMIT_MAX: '1' });
    const send = (email: string) =>
      request(app)
        .post('/api/v1/auth/password-recovery/request')
        .set('Origin', 'http://localhost:5173')
        .send({ email });
    expect((await send('ana@example.com')).status).toBe(202);
    const limited = await send('  ANA@example.com ');
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe('RATE_LIMITED');
    expect(Number(limited.headers['retry-after'])).toBeGreaterThan(0);
    expect(limited.headers['access-control-allow-origin']).toBe('http://localhost:5173');
    // Otro correo desde la misma IP sigue permitido hasta el límite por IP.
    expect((await send('otra@example.com')).status).toBe(202);
  });

  it('confirma recuperación y limpia cookies del navegador', async () => {
    const { app, auth } = fixture();
    const response = await request(app)
      .post('/api/v1/auth/password-recovery/confirm')
      .send({ token: 'a'.repeat(43), password: 'una-clave-segura-123' });
    expect(response.status).toBe(200);
    expect(auth.resetPassword).toHaveBeenCalledOnce();
    const cookies = (response.headers['set-cookie'] as unknown as string[]).join(';');
    expect(cookies).toContain('cabales_session=;');
  });

  it('limita POST y DELETE de suscripciones push por usuario', async () => {
    const notifications = {
      subscribePush: vi.fn(async () => ({ id: 'subscription-id' })),
      unsubscribePush: vi.fn(async () => undefined),
    } as unknown as NotificationsService;
    const { app } = fixture(true, { PUSH_SUBSCRIPTION_RATE_LIMIT_MAX: '1' }, notifications);
    const cookies = ['cabales_session=session-token', 'cabales_session_csrf=csrf-token'];
    const subscription = {
      endpoint: 'https://push.example.test/subscription',
      keys: { p256dh: 'p'.repeat(20), auth: 'a'.repeat(10) },
    };
    const first = await request(app)
      .post('/api/v1/notifications/push-subscriptions')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', 'csrf-token')
      .send(subscription);
    expect(first.status).toBe(201);
    const limitedDelete = await request(app)
      .delete('/api/v1/notifications/push-subscriptions')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', 'csrf-token')
      .send({ endpoint: subscription.endpoint });
    expect(limitedDelete.status).toBe(429);
    expect(limitedDelete.body.error.code).toBe('RATE_LIMITED');
    expect(notifications.unsubscribePush).not.toHaveBeenCalled();
  });

  it('rechaza tokens con caracteres fuera de base64url', async () => {
    const response = await request(fixture().app)
      .post('/api/v1/auth/email-verification/confirm')
      .send({ token: '<script>'.repeat(6) });
    expect(response.status).toBe(400);
  });

  it('PATCH /me exige CSRF y valida el cuerpo', async () => {
    const { app, auth } = fixture();
    const cookies = ['cabales_session=session-token', 'cabales_session_csrf=csrf-token'];
    const noCsrf = await request(app)
      .patch('/api/v1/auth/me')
      .set('Cookie', cookies)
      .send({ displayName: 'Ana M' });
    expect(noCsrf.status).toBe(403);
    const invalid = await request(app)
      .patch('/api/v1/auth/me')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', 'csrf-token')
      .send({ email: 'otro@example.com' });
    expect(invalid.status).toBe(400);
    const ok = await request(app)
      .patch('/api/v1/auth/me')
      .set('Cookie', cookies)
      .set('X-CSRF-Token', 'csrf-token')
      .send({ displayName: 'Ana M' });
    expect(ok.status).toBe(200);
    expect(auth.updateProfile).toHaveBeenCalledWith(
      user.id,
      { displayName: 'Ana M' },
      expect.any(String),
    );
  });

  it('no expone cabeceras de tecnología y fija políticas seguras', async () => {
    const response = await request(fixture().app).get('/health');
    expect(response.headers['x-powered-by']).toBeUndefined();
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['strict-transport-security']).toBeDefined();
  });
});
