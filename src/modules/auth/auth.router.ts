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
  type LoginInput,
  type RegisterInput,
} from './auth.schema.js';
import type { AuthPort, SessionResult } from './auth.service.js';
import { AppError } from '../../shared/errors.js';

function agent(req: Request) {
  const userAgent = req.header('user-agent')?.slice(0, 512);
  const ipAddress = req.ip?.slice(0, 64);
  return { ...(userAgent ? { userAgent } : {}), ...(ipAddress ? { ipAddress } : {}) };
}

function setSessionCookies(res: Response, result: SessionResult, config: AppConfig): void {
  const common = {
    secure: config.isProduction,
    sameSite: 'lax' as const,
    expires: result.expiresAt,
    path: '/',
  };
  res.cookie(config.COOKIE_NAME, result.sessionToken, { ...common, httpOnly: true });
  res.cookie(`${config.COOKIE_NAME}_csrf`, result.csrfToken, { ...common, httpOnly: false });
}

/** Rutas de identidad con rate limit externo y protección CSRF para cierre de sesión. */
export function createAuthRouter(authService: AuthPort, config: AppConfig): Router {
  const router = Router();
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
  router.post('/email-verification/request', validateBody(emailSchema), async (req, res) => {
    if (!authService.requestEmailVerification)
      throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Correo no disponible');
    await authService.requestEmailVerification(req.body.email);
    sendData(res, { accepted: true });
  });
  router.post('/email-verification/resend', validateBody(emailSchema), async (req, res) => {
    if (!authService.requestEmailVerification)
      throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Correo no disponible');
    await authService.requestEmailVerification(req.body.email);
    sendData(res, { accepted: true });
  });
  router.post('/email-verification/confirm', validateBody(emailTokenSchema), async (req, res) => {
    if (!authService.verifyEmail)
      throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Correo no disponible');
    sendData(res, { user: await authService.verifyEmail(req.body.token) });
  });
  router.post('/password-recovery/request', validateBody(emailSchema), async (req, res) => {
    if (!authService.requestPasswordReset)
      throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Correo no disponible');
    await authService.requestPasswordReset(req.body.email);
    sendData(res, { accepted: true });
  });
  router.post('/password-recovery/resend', validateBody(emailSchema), async (req, res) => {
    if (!authService.requestPasswordReset)
      throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Correo no disponible');
    await authService.requestPasswordReset(req.body.email);
    sendData(res, { accepted: true });
  });
  router.post('/password-recovery/confirm', validateBody(passwordResetSchema), async (req, res) => {
    if (!authService.resetPassword)
      throw new AppError(503, 'EMAIL_UNAVAILABLE', 'Correo no disponible');
    await authService.resetPassword(req.body);
    sendData(res, { reset: true });
  });
  router.get('/me', requireAuth(authService, config.COOKIE_NAME), (req, res) => {
    const csrfToken = csrfTokenFromCookie(req, config.COOKIE_NAME);
    sendData(res, { user: req.auth!.user, csrfToken });
  });
  router.post(
    '/logout',
    requireAuth(authService, config.COOKIE_NAME),
    requireCsrf(config.COOKIE_NAME),
    async (req, res) => {
      await authService.logout(req.cookies[config.COOKIE_NAME] as string);
      res.clearCookie(config.COOKIE_NAME, { path: '/' });
      res.clearCookie(`${config.COOKIE_NAME}_csrf`, { path: '/' });
      sendData(res, { loggedOut: true });
    },
  );
  return router;
}
