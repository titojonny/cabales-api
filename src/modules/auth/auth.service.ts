import argon2 from 'argon2';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import type { LoginInput, RegisterInput } from './auth.schema.js';
import { AuthRepository } from './auth.repository.js';

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
}

/** Reglas de autenticación; no conoce cookies ni Express. */
export class AuthService {
  constructor(
    private readonly repository: AuthRepository,
    private readonly sessionTtlMs: number,
  ) {}

  async register(input: RegisterInput, agent: RequestAgent): Promise<SessionResult> {
    const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
    try {
      const user = await this.repository.createUser({
        email: input.email,
        displayName: input.displayName,
        passwordHash,
      });
      return this.issueSession(user, agent);
    } catch (error) {
      if (AuthRepository.isUniqueError(error)) {
        throw new AppError(409, 'EMAIL_IN_USE', 'El correo ya esta registrado');
      }
      throw error;
    }
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
}
