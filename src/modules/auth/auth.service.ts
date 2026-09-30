import argon2 from 'argon2';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import type {
  LoginInput,
  PasswordResetInput,
  RegisterInput,
  UpdateProfileInput,
} from './auth.schema.js';
import { AuthRepository } from './auth.repository.js';
import { emailTemplates, type EmailProvider } from '../../infrastructure/email.js';
import type { BackgroundTasks } from '../../infrastructure/background.js';

interface RequestAgent {
  userAgent?: string;
  ipAddress?: string;
}

/** Identidad pública del titular autenticado. */
export interface PublicUser {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  locale: string;
  emailVerified: boolean;
}

/** Identidad confiable obtenida exclusivamente de una sesión válida. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  csrfTokenHash: string;
  user: PublicUser;
}

/** Material de sesión que solo cruza la frontera durante su emisión. */
export interface SessionResult {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  user: PublicUser;
}

/** Puerto consumido por HTTP para permitir pruebas sin PostgreSQL. */
export interface AuthPort {
  register(input: RegisterInput, agent: RequestAgent): Promise<SessionResult>;
  login(input: LoginInput, agent: RequestAgent): Promise<SessionResult>;
  authenticate(sessionToken: string): Promise<AuthContext>;
  logout(sessionToken: string): Promise<void>;
  requestEmailVerification(email: string): Promise<void>;
  verifyEmail(token: string, requestId: string): Promise<PublicUser>;
  requestPasswordReset(email: string): Promise<void>;
  resetPassword(input: PasswordResetInput, requestId: string): Promise<void>;
  updateProfile(userId: string, input: UpdateProfileInput, requestId: string): Promise<PublicUser>;
  verifyPassword(userId: string, password: string): Promise<boolean>;
}

/** Tiempos de vida y origen usados para construir enlaces. */
export interface AuthSettings {
  sessionTtlMs: number;
  emailVerificationTtlMs: number;
  passwordResetTtlMs: number;
  appOrigin: string;
  /** Intervalo mínimo entre correos del mismo tipo al mismo usuario. */
  resendCooldownMs?: number;
}

const SESSION_TOUCH_MS = 5 * 60 * 1000;

/** Reglas de autenticación; no conoce cookies ni Express. */
export class AuthService implements AuthPort {
  private readonly cooldownMs: number;

  constructor(
    private readonly repository: AuthRepository,
    private readonly settings: AuthSettings,
    private readonly emailProvider: EmailProvider,
    private readonly background: BackgroundTasks,
  ) {
    this.cooldownMs = settings.resendCooldownMs ?? 60_000;
  }

  async register(input: RegisterInput, agent: RequestAgent): Promise<SessionResult> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    let user: PublicUser;
    try {
      user = await this.repository.createUser({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      });
    } catch (error) {
      if (AuthRepository.isUniqueError(error)) {
        throw new AppError(409, 'EMAIL_IN_USE', 'El correo ya esta registrado');
      }
      throw error;
    }
    this.background.run('auth.verification_email', () =>
      this.sendVerification(user.id, user.email, false),
    );
    return this.issueSession(user, agent);
  }

  /** Respuesta constante: la búsqueda, el token y el envío ocurren fuera de la petición. */
  async requestEmailVerification(email: string): Promise<void> {
    this.background.run('auth.verification_email', async () => {
      const user = await this.repository.findUserByEmail(email);
      if (user?.isActive && !user.emailVerifiedAt)
        await this.sendVerification(user.id, user.email, true);
    });
  }

  async verifyEmail(token: string, requestId: string): Promise<PublicUser> {
    const user = await this.repository.claimEmailVerification(hashToken(token), requestId);
    ensure(user, 400, 'EMAIL_TOKEN_INVALID', 'El enlace de correo no es valido o expiro');
    return user;
  }

  /** Respuesta constante y sin enumeración; invalida enlaces previos al emitir uno nuevo. */
  async requestPasswordReset(email: string): Promise<void> {
    this.background.run('auth.password_reset_email', async () => {
      const user = await this.repository.findUserByEmail(email);
      if (!user?.isActive) return;
      if (await this.inCooldown('reset', user.id)) return;
      const token = randomToken();
      await this.repository.replaceToken('reset', {
        userId: user.id,
        tokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + this.settings.passwordResetTtlMs),
      });
      await this.emailProvider.send({
        to: user.email,
        ...emailTemplates.resetPassword(
          this.settings.appOrigin,
          token,
          Math.round(this.settings.passwordResetTtlMs / 60_000),
        ),
      });
    });
  }

  async resetPassword(input: PasswordResetInput, requestId: string): Promise<void> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    const reset = await this.repository.resetPasswordAtomic(
      hashToken(input.token),
      passwordHash,
      requestId,
    );
    ensure(reset, 400, 'PASSWORD_TOKEN_INVALID', 'El enlace de recuperacion no es valido o expiro');
  }

  async login(input: LoginInput, agent: RequestAgent): Promise<SessionResult> {
    const account = await this.repository.findPasswordAccount(input.email);
    if (!account?.passwordHash || !account.user.isActive) {
      // Conserva un coste Argon2 similar al caso válido para reducir enumeración por tiempo.
      await argon2.hash(input.password, { type: argon2.argon2id });
      throw new AppError(401, 'INVALID_CREDENTIALS', 'Credenciales invalidas');
    }
    const valid = await argon2.verify(account.passwordHash, input.password);
    ensure(valid, 401, 'INVALID_CREDENTIALS', 'Credenciales invalidas');
    const { isActive: _isActive, emailVerifiedAt, ...rest } = account.user;
    return this.issueSession({ ...rest, emailVerified: emailVerifiedAt !== null }, agent);
  }

  async authenticate(sessionToken: string): Promise<AuthContext> {
    const session = await this.repository.findSession(hashToken(sessionToken));
    ensure(
      session &&
        !session.revokedAt &&
        session.expiresAt.getTime() > Date.now() &&
        session.user.isActive,
      401,
      'SESSION_INVALID',
      'La sesion no es valida o expiro',
    );
    if (Date.now() - session.lastSeenAt.getTime() > SESSION_TOUCH_MS) {
      this.background.run('auth.session_touch', () =>
        this.repository.touchSession(session.id, new Date(Date.now() - SESSION_TOUCH_MS)),
      );
    }
    const { isActive: _isActive, emailVerifiedAt, ...user } = session.user;
    return {
      sessionId: session.id,
      userId: session.userId,
      csrfTokenHash: session.csrfTokenHash,
      user: { ...user, emailVerified: emailVerifiedAt !== null },
    };
  }

  async logout(sessionToken: string): Promise<void> {
    await this.repository.revokeByToken(hashToken(sessionToken));
  }

  async updateProfile(
    userId: string,
    input: UpdateProfileInput,
    requestId: string,
  ): Promise<PublicUser> {
    return this.repository.updateProfile(
      userId,
      {
        ...(input.displayName !== undefined ? { displayName: input.displayName } : {}),
        ...(input.locale !== undefined ? { locale: input.locale } : {}),
      },
      requestId,
    );
  }

  /** Reautenticación para operaciones destructivas (p. ej. supresión de cuenta). */
  async verifyPassword(userId: string, password: string): Promise<boolean> {
    const hash = await this.repository.findPasswordHash(userId);
    if (!hash) return false;
    return argon2.verify(hash, password).catch(() => false);
  }

  private async inCooldown(kind: 'verification' | 'reset', userId: string): Promise<boolean> {
    const latest = await this.repository.latestTokenAt(kind, userId);
    return latest !== null && Date.now() - latest.getTime() < this.cooldownMs;
  }

  private async issueSession(user: PublicUser, agent: RequestAgent): Promise<SessionResult> {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.settings.sessionTtlMs);
    await this.repository.createSession({
      userId: user.id,
      tokenHash: hashToken(sessionToken),
      csrfTokenHash: hashToken(csrfToken),
      expiresAt,
      ...(agent.userAgent ? { userAgent: agent.userAgent } : {}),
      ...(agent.ipAddress ? { ipAddress: agent.ipAddress } : {}),
    });
    return { sessionToken, csrfToken, expiresAt, user };
  }

  private async sendVerification(
    userId: string,
    email: string,
    enforceCooldown: boolean,
  ): Promise<void> {
    if (enforceCooldown && (await this.inCooldown('verification', userId))) return;
    const token = randomToken();
    await this.repository.replaceToken('verification', {
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.settings.emailVerificationTtlMs),
    });
    await this.emailProvider.send({
      to: email,
      ...emailTemplates.verifyEmail(
        this.settings.appOrigin,
        token,
        Math.round(this.settings.emailVerificationTtlMs / 3_600_000),
      ),
    });
  }
}
