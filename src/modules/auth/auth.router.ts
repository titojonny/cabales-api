import { timingSafeEqual } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { AppConfig } from '../../config/env.js';
import { csrfTokenFromCookie, requireAuth, requireCsrf } from '../../http/middleware.js';
import { sendData } from '../../http/response.js';
import { hashToken } from '../../shared/crypto.js';
import { ensure } from '../../shared/errors.js';
import { validateBody, validateQuery } from '../../shared/validation.js';
import {
  emailSchema,
  emailTokenSchema,
  googleCallbackQuerySchema,
  loginSchema,
  passwordResetSchema,
  registerSchema,
  updateProfileSchema,
  type EmailInput,
  type LoginInput,
  type PasswordResetInput,
  type RegisterInput,
  type UpdateProfileInput,
} from './auth.schema.js';
import type { AuthPort, SessionResult } from './auth.service.js';

const GOOGLE_STATE_COOKIE = 'google_state';
const GOOGLE_NONCE_COOKIE = 'google_nonce';
const GOOGLE_VERIFIER_COOKIE = 'google_verifier';
const GOOGLE_SESSION_COOKIE = 'google_session';
const GOOGLE_TRANSACTION_MS = 10 * 60 * 1000;

function agent(req: Request) {
  const userAgent = req.header('user-agent')?.slice(0, 512);
  const ipAddress = req.ip?.slice(0, 64);
  return { ...(userAgent ? { userAgent } : {}), ...(ipAddress ? { ipAddress } : {}) };
}

function cookieOptions(config: AppConfig) {
  return { secure: config.isProduction, sameSite: 'lax' as const, path: '/' };
}

function setSessionCookies(res: Response, result: SessionResult, config: AppConfig): void {
  const common = { ...cookieOptions(config), expires: result.expiresAt };
  res.cookie(config.COOKIE_NAME, result.sessionToken, { ...common, httpOnly: true });
  res.cookie(`${config.COOKIE_NAME}_csrf`, result.csrfToken, { ...common, httpOnly: false });
}

function googleCookieName(config: AppConfig, suffix: string): string {
  return `${config.COOKIE_NAME}_${suffix}`;
}

function setGoogleTransactionCookies(
  res: Response,
  result: { state: string; nonce: string; codeVerifier: string },
  config: AppConfig,
  sessionBinding?: string,
): void {
  const common = {
    ...cookieOptions(config),
    httpOnly: true,
    maxAge: GOOGLE_TRANSACTION_MS,
  } as const;
  res.cookie(googleCookieName(config, GOOGLE_STATE_COOKIE), result.state, common);
  res.cookie(googleCookieName(config, GOOGLE_NONCE_COOKIE), result.nonce, common);
  res.cookie(googleCookieName(config, GOOGLE_VERIFIER_COOKIE), result.codeVerifier, common);
  if (sessionBinding)
    res.cookie(googleCookieName(config, GOOGLE_SESSION_COOKIE), sessionBinding, common);
  else res.clearCookie(googleCookieName(config, GOOGLE_SESSION_COOKIE), cookieOptions(config));
}

function clearGoogleTransactionCookies(res: Response, config: AppConfig): void {
  for (const suffix of [
    GOOGLE_STATE_COOKIE,
    GOOGLE_NONCE_COOKIE,
    GOOGLE_VERIFIER_COOKIE,
    GOOGLE_SESSION_COOKIE,
  ])
    res.clearCookie(googleCookieName(config, suffix), cookieOptions(config));
}

function compareOpaqueValues(actual: string | undefined, expected: string | undefined): boolean {
  if (!actual || !expected) return false;
  const actualBuffer = Buffer.from(actual);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

/** Rutas de identidad con rate limit externo y protección CSRF para mutaciones autenticadas. */
export function createAuthRouter(authService: AuthPort, config: AppConfig): Router {
  const router = Router();
  const authenticated = requireAuth(authService, config.COOKIE_NAME);
  const csrf = requireCsrf(config.COOKIE_NAME);

  router.get('/config', (_req, res) => {
    sendData(res, { googleEnabled: authService.googleEnabled?.() === true });
  });

  router.get('/google/start', async (req, res) => {
    ensure(
      authService.beginGoogleAuth,
      404,
      'GOOGLE_DISABLED',
      'El inicio con Google no esta habilitado',
    );
    const result = await authService.beginGoogleAuth('login');
    setGoogleTransactionCookies(res, result, config);
    res.redirect(result.authorizationUrl);
  });

  router.post('/google/link/start', authenticated, csrf, async (req, res) => {
    ensure(
      authService.beginGoogleAuth,
      404,
      'GOOGLE_DISABLED',
      'El inicio con Google no esta habilitado',
    );
    const result = await authService.beginGoogleAuth('link', req.auth!.userId);
    const sessionToken = req.cookies?.[config.COOKIE_NAME] as string | undefined;
    ensure(sessionToken, 401, 'AUTH_REQUIRED', 'Autenticacion requerida');
    setGoogleTransactionCookies(res, result, config, hashToken(sessionToken));
    sendData(res, { authorizationUrl: result.authorizationUrl });
  });

  router.get('/google/callback', validateQuery(googleCallbackQuerySchema), async (req, res) => {
    ensure(
      authService.completeGoogleAuth,
      404,
      'GOOGLE_DISABLED',
      'El inicio con Google no esta habilitado',
    );
    const state = req.validatedQuery as { code?: string; error?: string; state: string };
    const stateCookie = req.cookies?.[googleCookieName(config, GOOGLE_STATE_COOKIE)] as
      string | undefined;
    const nonce = req.cookies?.[googleCookieName(config, GOOGLE_NONCE_COOKIE)] as
      string | undefined;
    const codeVerifier = req.cookies?.[googleCookieName(config, GOOGLE_VERIFIER_COOKIE)] as
      string | undefined;
    const sessionBinding = req.cookies?.[googleCookieName(config, GOOGLE_SESSION_COOKIE)] as
      string | undefined;
    try {
      ensure(
        compareOpaqueValues(state.state, stateCookie),
        400,
        'OAUTH_STATE_INVALID',
        'La transaccion de Google no es valida o expiro',
      );
      ensure(
        nonce && /^[A-Za-z0-9_-]{32,256}$/.test(nonce),
        400,
        'OAUTH_NONCE_INVALID',
        'La transaccion de Google no es valida',
      );
      ensure(
        codeVerifier && /^[A-Za-z0-9_-]{32,256}$/.test(codeVerifier),
        400,
        'OAUTH_PKCE_INVALID',
        'La transaccion de Google no es valida',
      );
      if (sessionBinding) {
        const sessionToken = req.cookies?.[config.COOKIE_NAME] as string | undefined;
        ensure(
          sessionToken && compareOpaqueValues(sessionBinding, hashToken(sessionToken)),
          400,
          'OAUTH_SESSION_INVALID',
          'La transaccion de Google no pertenece a la sesion actual',
        );
      }
      ensure(
        state.code,
        400,
        'GOOGLE_AUTH_DENIED',
        state.error === 'access_denied'
          ? 'El acceso con Google fue cancelado'
          : 'Google no completo la autenticacion',
      );
      const result = await authService.completeGoogleAuth({
        state: state.state,
        nonce,
        code: state.code,
        codeVerifier,
        agent: agent(req),
      });
      if (result.session) setSessionCookies(res, result.session, config);
      const destination =
        result.intent === 'link' ? '/app/mas?google=linked' : '/app?google=connected';
      clearGoogleTransactionCookies(res, config);
      res.redirect(new URL(destination, config.APP_ORIGIN).toString());
    } finally {
      if (!res.headersSent) clearGoogleTransactionCookies(res, config);
    }
  });

  router.post('/register', validateBody(registerSchema), async (req, res) => {
    const result = await authService.register(req.body as RegisterInput, agent(req));
    setSessionCookies(res, result, config);
    sendData(res, { user: result.user, csrfToken: result.csrfToken }, 201);
  });
  router.post('/login', validateBody(loginSchema), async (req, res) => {
    const result = await authService.login(req.body as LoginInput, agent(req));
    setSessionCookies(res, result, config);
    sendData(res, { user: result.user, csrfToken: result.csrfToken });
  });

  // Anti-enumeración: 202 idéntico exista o no la cuenta; el trabajo ocurre en segundo plano.
  for (const path of ['/email-verification/request', '/email-verification/resend']) {
    router.post(path, validateBody(emailSchema), async (req, res) => {
      await authService.requestEmailVerification((req.body as EmailInput).email);
      sendData(res, { accepted: true }, 202);
    });
  }
  router.post('/email-verification/confirm', validateBody(emailTokenSchema), async (req, res) => {
    sendData(res, { user: await authService.verifyEmail(req.body.token as string, req.requestId) });
  });
  for (const path of ['/password-recovery/request', '/password-recovery/resend']) {
    router.post(path, validateBody(emailSchema), async (req, res) => {
      await authService.requestPasswordReset((req.body as EmailInput).email);
      sendData(res, { accepted: true }, 202);
    });
  }
  router.post('/password-recovery/confirm', validateBody(passwordResetSchema), async (req, res) => {
    await authService.resetPassword(req.body as PasswordResetInput, req.requestId);
    // Todas las sesiones quedaron revocadas; también se limpian las cookies de este navegador.
    res.clearCookie(config.COOKIE_NAME, cookieOptions(config));
    res.clearCookie(`${config.COOKIE_NAME}_csrf`, cookieOptions(config));
    sendData(res, { reset: true });
  });

  router.get('/me', authenticated, (req, res) => {
    const csrfToken = csrfTokenFromCookie(req, config.COOKIE_NAME);
    sendData(res, { user: req.auth!.user, csrfToken });
  });
  router.get('/methods', authenticated, async (req, res) => {
    ensure(
      authService.authMethods,
      404,
      'AUTH_METHODS_UNAVAILABLE',
      'Metodos de acceso no disponibles',
    );
    sendData(res, await authService.authMethods(req.auth!.userId));
  });
  router.patch('/me', authenticated, csrf, validateBody(updateProfileSchema), async (req, res) => {
    const user = await authService.updateProfile(
      req.auth!.userId,
      req.body as UpdateProfileInput,
      req.requestId,
    );
    sendData(res, { user });
  });
  router.post('/logout', authenticated, csrf, async (req, res) => {
    await authService.logout(req.cookies[config.COOKIE_NAME] as string);
    res.clearCookie(config.COOKIE_NAME, cookieOptions(config));
    res.clearCookie(`${config.COOKIE_NAME}_csrf`, cookieOptions(config));
    sendData(res, { loggedOut: true });
  });
  router.delete('/google', authenticated, csrf, async (req, res) => {
    ensure(authService.unlinkGoogle, 404, 'GOOGLE_DISABLED', 'Google no esta disponible');
    await authService.unlinkGoogle(req.auth!.userId);
    sendData(res, { unlinked: true });
  });
  return router;
}
