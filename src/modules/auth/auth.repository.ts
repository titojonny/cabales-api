import { AccountProvider, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';

const userSelect = {
  id: true,
  email: true,
  displayName: true,
  avatarUrl: true,
  locale: true,
  emailVerifiedAt: true,
} as const;

type UserRow = Prisma.UserGetPayload<{ select: typeof userSelect }>;

/** Vista pública del titular autenticado; nunca incluye hashes ni estado interno. */
export function toPublicUser(user: UserRow) {
  return {
    id: user.id,
    email: user.email,
    displayName: user.displayName,
    avatarUrl: user.avatarUrl,
    locale: user.locale,
    emailVerified: user.emailVerifiedAt !== null,
  };
}

/** Persistencia exclusiva del módulo de identidad y sesiones. */
export class AuthRepository {
  constructor(private readonly db: Database) {}

  async createUser(input: { email: string; displayName: string; passwordHash: string }) {
    const user = await this.db.user.create({
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
      select: userSelect,
    });
    return toPublicUser(user);
  }

  findUserByEmail(email: string) {
    return this.db.user.findUnique({
      where: { email },
      select: { id: true, email: true, displayName: true, isActive: true, emailVerifiedAt: true },
    });
  }

  /** Último token emitido, usado para limitar reenvíos silenciosamente. */
  async latestTokenAt(kind: 'verification' | 'reset', userId: string): Promise<Date | null> {
    const where = { userId };
    const row =
      kind === 'verification'
        ? await this.db.emailVerificationToken.findFirst({
            where,
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          })
        : await this.db.passwordResetToken.findFirst({
            where,
            orderBy: { createdAt: 'desc' },
            select: { createdAt: true },
          });
    return row?.createdAt ?? null;
  }

  /** Emite un token nuevo e invalida los anteriores no usados del mismo tipo. */
  async replaceToken(
    kind: 'verification' | 'reset',
    input: { userId: string; tokenHash: string; expiresAt: Date },
  ) {
    const now = new Date();
    await this.db.$transaction(async (tx) => {
      if (kind === 'verification') {
        await tx.emailVerificationToken.updateMany({
          where: { userId: input.userId, usedAt: null },
          data: { usedAt: now },
        });
        await tx.emailVerificationToken.create({ data: input });
      } else {
        await tx.passwordResetToken.updateMany({
          where: { userId: input.userId, usedAt: null },
          data: { usedAt: now },
        });
        await tx.passwordResetToken.create({ data: input });
      }
    });
  }

  /** Consume el token una sola vez y verifica el correo en la misma transacción. */
  async claimEmailVerification(tokenHash: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const token = await tx.emailVerificationToken.findUnique({
        where: { tokenHash },
        select: { id: true, userId: true, user: { select: { isActive: true } } },
      });
      if (!token || !token.user.isActive) return null;
      const claimed = await tx.emailVerificationToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return null;
      const user = await tx.user.update({
        where: { id: token.userId },
        data: { emailVerifiedAt: now },
        select: userSelect,
      });
      await tx.auditLog.create({
        data: {
          userId: token.userId,
          action: 'auth.email_verified',
          entityType: 'User',
          entityId: token.userId,
          requestId,
        },
      });
      return toPublicUser(user);
    });
  }

  /**
   * Consume el token de recuperación, cambia la contraseña, revoca todas las sesiones e
   * invalida otros tokens pendientes como una única unidad atómica.
   */
  async resetPasswordAtomic(tokenHash: string, passwordHash: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const now = new Date();
      const token = await tx.passwordResetToken.findUnique({
        where: { tokenHash },
        select: {
          id: true,
          userId: true,
          user: { select: { isActive: true, emailVerifiedAt: true } },
        },
      });
      if (!token || !token.user.isActive) return false;
      const claimed = await tx.passwordResetToken.updateMany({
        where: { id: token.id, usedAt: null, expiresAt: { gt: now } },
        data: { usedAt: now },
      });
      if (claimed.count !== 1) return false;
      await tx.account.updateMany({
        where: { userId: token.userId, provider: AccountProvider.PASSWORD },
        data: { passwordHash },
      });
      await tx.session.updateMany({
        where: { userId: token.userId, revokedAt: null },
        data: { revokedAt: now },
      });
      await tx.passwordResetToken.updateMany({
        where: { userId: token.userId, usedAt: null },
        data: { usedAt: now },
      });
      // Recibir el enlace demuestra control del buzón.
      if (!token.user.emailVerifiedAt) {
        await tx.user.update({ where: { id: token.userId }, data: { emailVerifiedAt: now } });
      }
      await tx.auditLog.create({
        data: {
          userId: token.userId,
          action: 'auth.password_reset',
          entityType: 'User',
          entityId: token.userId,
          requestId,
        },
      });
      return true;
    });
  }

  async findPasswordAccount(email: string) {
    return this.db.account.findUnique({
      where: {
        provider_providerAccountId: {
          provider: AccountProvider.PASSWORD,
          providerAccountId: email,
        },
      },
      include: { user: { select: { ...userSelect, isActive: true } } },
    });
  }

  async findPasswordHash(userId: string) {
    const account = await this.db.account.findFirst({
      where: { userId, provider: AccountProvider.PASSWORD },
      select: { passwordHash: true },
    });
    return account?.passwordHash ?? null;
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
      include: { user: { select: { ...userSelect, isActive: true } } },
    });
  }

  /** Actualiza lastSeenAt como máximo una vez cada pocos minutos para no escribir en cada petición. */
  async touchSession(id: string, before: Date) {
    await this.db.session.updateMany({
      where: { id, lastSeenAt: { lt: before } },
      data: { lastSeenAt: new Date() },
    });
  }

  async revokeByToken(tokenHash: string) {
    await this.db.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async updateProfile(
    userId: string,
    data: { displayName?: string; locale?: string },
    requestId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const user = await tx.user.update({ where: { id: userId }, data, select: userSelect });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'user.profile_updated',
          entityType: 'User',
          entityId: userId,
          requestId,
          metadata: { fields: Object.keys(data) },
        },
      });
      return toPublicUser(user);
    });
  }

  /** Identifica colisiones únicas sin exponer mensajes internos de Prisma. */
  static isUniqueError(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}
