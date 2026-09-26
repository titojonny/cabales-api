import { AccountProvider, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';

const publicUser = { id: true, email: true, displayName: true, avatarUrl: true } as const;

/** Persistencia exclusiva del módulo de identidad y sesiones. */
export class AuthRepository {
  constructor(private readonly db: Database) {}

  async createUser(input: { email: string; displayName: string; passwordHash: string }) {
    return this.db.user.create({
      data: {
        email: input.email,
        displayName: input.displayName,
        accounts: {
          create: {
            provider: AccountProvider.PASSWORD,
            providerAccountId: input.email,
            passwordHash: input.passwordHash,
          },
        },
      },
      select: publicUser,
    });
  }

  async createEmailVerificationToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.db.emailVerificationToken.create({ data: input });
  }

  async findUserByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, isActive: true, emailVerifiedAt: true },
    });
  }

  async claimEmailVerification(tokenHash: string) {
    const result = await this.db.emailVerificationToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (result.count !== 1) return null;
    const token = await this.db.emailVerificationToken.findUnique({ where: { tokenHash } });
    if (!token) return null;
    return this.db.user.update({
      where: { id: token.userId },
      data: { emailVerifiedAt: new Date() },
      select: publicUser,
    });
  }

  async createPasswordResetToken(input: { userId: string; tokenHash: string; expiresAt: Date }) {
    return this.db.passwordResetToken.create({ data: input });
  }

  async claimPasswordReset(tokenHash: string) {
    const result = await this.db.passwordResetToken.updateMany({
      where: { tokenHash, usedAt: null, expiresAt: { gt: new Date() } },
      data: { usedAt: new Date() },
    });
    if (result.count !== 1) return null;
    return this.db.passwordResetToken.findUnique({ where: { tokenHash } });
  }

  async updatePasswordAndRevokeSessions(userId: string, passwordHash: string) {
    await this.db.$transaction([
      this.db.account.updateMany({
        where: { userId, provider: AccountProvider.PASSWORD },
        data: { passwordHash },
      }),
      this.db.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
  }

  async findPasswordAccount(email: string) {
    return this.db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AccountProvider.PASSWORD,
          providerAccountId: email,
        },
      },
      include: { user: { select: { ...publicUser, isActive: true } } },
    });
  }

  async createSession(input: {
    userId: string;
    tokenHash: string;
    csrfTokenHash: string;
    expiresAt: Date;
    userAgent?: string;
    ipAddress?: string;
  }) {
    return this.db.session.create({ data: input });
  }

  async findSession(tokenHash: string) {
    return this.db.session.findUnique({
      where: { tokenHash },
      include: { user: { select: { ...publicUser, isActive: true } } },
    });
  }

  async revokeSession(id: string) {
    await this.db.session.updateMany({
      where: { id, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async revokeByToken(tokenHash: string) {
    await this.db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Identifica colisiones únicas sin exponer mensajes internos de Prisma. */
  static isUniqueError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
