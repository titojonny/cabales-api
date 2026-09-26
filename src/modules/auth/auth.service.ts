import argon2 from 'argon2';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';
import type { EmailInput, PasswordResetInput } from './auth.schema.js';
import { AuthRepository } from './auth.repository.js';
import type { EmailProvider } from '../../infrastructure/email.js';

interface RequestAgent {
  userAgent?: string;
  ipAddress?: string;
}

/** Identidad confiable obtenida exclusivamente de una sesión válida. */
export interface AuthContext {
  sessionId: string;
  userId: string;
  csrfTokenHash: string;
  user: { id: string; email: string; displayName: string; avatarUrl: string | null };
}

/** Material de sesión que solo cruza la frontera durante su emisión. */
export interface SessionResult {
  sessionToken: string;
  csrfToken: string;
  expiresAt: Date;
  user: AuthContext['user'];
}

/** Puerto consumido por HTTP para permitir pruebas sin PostgreSQL. */
export interface AuthPort {
  register(input: RegisterInput, agent: RequestAgent): Promise<SessionResult>;
  login(input: LoginInput, agent: RequestAgent): Promise<SessionResult>;
  authenticate(sessionToken: string): Promise<AuthContext>;
  logout(sessionToken: string): Promise<void>;
  requestEmailVerification?(email: string): Promise<void>;
  verifyEmail?(token: string): Promise<AuthContext['user']>;
  requestPasswordReset?(email: string): Promise<void>;
  resetPassword?(input: PasswordResetInput): Promise<void>;
}

/** Reglas de autenticación; no conoce cookies ni Express. */
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMs: number,
    private readonly emailProvider: EmailProvider,
    private readonly emailVerificationTtlMs: number,
    private readonly passwordResetTtlMs: number,
    private readonly appOrigin: string,
  ) {}

  async register(input: RegisterInput, agent: RequestAgent): Promise<SessionResult> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await this.repository.createUser({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      });
      await this.sendVerification(user.id, user.email);
      return this.issueSession(user, agent);
    } catch (error) {
      if (AuthRepository.isUniqueError(error)) {
        throw new AppError(409, 'EMAIL_IN_USE', 'El correo ya esta registrado');
      }
      throw error;
    }
  }

  async requestEmailVerification(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    if (user?.isActive && !user.emailVerifiedAt) await this.sendVerification(user.id, user.email);
  }

  async verifyEmail(token: string): Promise<AuthContext['user']> {
    const user = await this.repository.claimEmailVerification(hashToken(token));
    ensure(user, 400, 'EMAIL_TOKEN_INVALID', 'El enlace de correo no es valido o expiro');
    return user;
  }

  async requestPasswordReset(email: string): Promise<void> {
    const user = await this.repository.findUserByEmail(email);
    if (!user?.isActive) return;
    const token = randomToken();
    await this.repository.createPasswordResetToken({
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.passwordResetTtlMs),
    });
    await this.emailProvider.send({
      to: user.email,
      subject: 'Recupera tu acceso a Cabales',
      text: `Abre ${this.appOrigin}/reset-password#token=${token} para definir una nueva contraseña.`,
    });
  }

  async resetPassword(input: PasswordResetInput): Promise<void> {
    const token = await this.repository.claimPasswordReset(hashToken(input.token));
    ensure(token, 400, 'PASSWORD_TOKEN_INVALID', 'El enlace de recuperación no es valido o expiro');
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    await this.repository.updatePasswordAndRevokeSessions(token.userId, passwordHash);
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
    return this.issueSession(account.user, agent);
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
    return {
      sessionId: session.id,
      userId: session.userId,
      csrfTokenHash: session.csrfTokenHash,
      user: session.user,
    };
  }

  async logout(sessionToken: string): Promise<void> {
    await this.repository.revokeByToken(hashToken(sessionToken));
  }

  private async issueSession(
    user: AuthContext['user'],
    agent: RequestAgent,
  ): Promise<SessionResult> {
    const sessionToken = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.sessionTtlMs);
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

  private async sendVerification(userId: string, email: string): Promise<void> {
    const token = randomToken();
    await this.repository.createEmailVerificationToken({
      userId,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + this.emailVerificationTtlMs),
    });
    await this.emailProvider.send({
      to: email,
      subject: 'Verifica tu correo de Cabales',
      text: `Abre ${this.appOrigin}/verify-email#token=${token} para verificar tu correo.`,
    });
  }
}
