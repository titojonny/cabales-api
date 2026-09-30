import { Router, type Request, type Response } from 'express';
import type { AppConfig } from '../../config/env.js';
import { csrfTokenFromCookie, requireAuth, requireCsrf } from '../../http/middleware.js';
import { sendData } from '../../http/response.js';
import { validateBody } from '../../shared/validation.js';
import {
  emailSchema,
  emailTokenSchema,
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

/** Rutas de identidad con rate limit externo y protección CSRF para mutaciones autenticadas. */
export function createAuthRouter(authService: AuthPort, config: AppConfig): Router {
  const router = Router();
  const authenticated = requireAuth(authService, config.COOKIE_NAME);
  const csrf = requireCsrf(config.COOKIE_NAME);

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
  return router;
}
