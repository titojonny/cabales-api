import { AccountProvider, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import type { GoogleIdentity } from '../../infrastructure/google-oauth.js';

// Se mantiene como literal para que el servidor no dependa de un cliente Prisma generado antes de P9.
const GOOGLE_PROVIDER = 'GOOGLE' as AccountProvider;

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

  async createOAuthState(input: {
    stateHash: string;
    nonceHash: string;
    intent: 'login' | 'link';
    userId?: string;
    expiresAt: Date;
  }) {
    return this.db.oAuthState.create({
      data: {
        stateHash: input.stateHash,
        nonceHash: input.nonceHash,
        intent: input.intent,
        expiresAt: input.expiresAt,
        ...(input.userId ? { userId: input.userId } : {}),
      },
    });
  }

  /** Reclama state una sola vez y evita reutilizar callbacks o transacciones caducadas. */
  async consumeOAuthState(stateHash: string) {
    return this.db.$transaction(async (tx) => {
      const row = await tx.oAuthState.findUnique({
        where: { stateHash },
        select: {
          id: true,
          nonceHash: true,
          intent: true,
          userId: true,
          expiresAt: true,
          usedAt: true,
        },
      });
      if (!row || row.usedAt || row.expiresAt.getTime() <= Date.now()) return null;
      const claimed = await tx.oAuthState.updateMany({
        where: { id: row.id, usedAt: null, expiresAt: { gt: new Date() } },
        data: { usedAt: new Date() },
      });
      return claimed.count === 1 ? row : null;
    });
  }

  /** Resuelve login o vinculación en una transacción, siempre desde una identidad Google verificada. */
  async linkOrCreateGoogle(identity: GoogleIdentity, linkUserId?: string) {
    return this.db.$transaction(async (tx) => {
      if (identity.emailVerified !== true) return { status: 'unverified' as const };
      const existingGoogle = await tx.account.findUnique({
        where: {
          provider_providerAccountId: {
            provider: GOOGLE_PROVIDER,
            providerAccountId: identity.subject,
          },
        },
        select: { userId: true },
      });

      if (linkUserId) {
        const target = await tx.user.findUnique({
          where: { id: linkUserId },
          select: { ...userSelect, isActive: true },
        });
        if (!target || !target.isActive) return { status: 'inactive' as const };
        if (existingGoogle && existingGoogle.userId !== target.id)
          return { status: 'conflict' as const };
        if (!existingGoogle) {
          await tx.account.create({
            data: {
              userId: target.id,
              provider: GOOGLE_PROVIDER,
              providerAccountId: identity.subject,
            },
          });
        }
        const user =
          target.email === identity.email && !target.emailVerifiedAt
            ? await tx.user.update({
                where: { id: target.id },
                data: { emailVerifiedAt: new Date() },
                select: userSelect,
              })
            : target;
        return { status: 'linked' as const, user: toPublicUser(user) };
      }

      let user = existingGoogle
        ? await tx.user.findUnique({
            where: { id: existingGoogle.userId },
            select: { ...userSelect, isActive: true },
          })
        : await tx.user.findUnique({
            where: { email: identity.email },
            select: { ...userSelect, isActive: true },
          });
      if (user && !user.isActive) return { status: 'inactive' as const };

      if (!user) {
        user = await tx.user.create({
          data: {
            email: identity.email,
            displayName: (identity.displayName ?? identity.email.split('@')[0]!).slice(0, 120),
            ...(identity.avatarUrl ? { avatarUrl: identity.avatarUrl } : {}),
            emailVerifiedAt: new Date(),
            accounts: {
              create: {
                provider: GOOGLE_PROVIDER,
                providerAccountId: identity.subject,
              },
            },
          },
          select: { ...userSelect, isActive: true },
        });
      } else {
        if (!existingGoogle) {
          await tx.account.create({
            data: {
              userId: user.id,
              provider: GOOGLE_PROVIDER,
              providerAccountId: identity.subject,
            },
          });
        }
        if (!user.emailVerifiedAt) {
          user = await tx.user.update({
            where: { id: user.id },
            data: { emailVerifiedAt: new Date() },
            select: { ...userSelect, isActive: true },
          });
        }
      }
      return { status: 'authenticated' as const, user: toPublicUser(user) };
    });
  }

  async authMethods(userId: string) {
    const accounts = await this.db.account.findMany({
      where: { userId },
      select: { provider: true },
      orderBy: { createdAt: 'asc' },
    });
    return {
      providers: accounts.map((account) => String(account.provider) as 'PASSWORD' | 'GOOGLE'),
      hasPassword: accounts.some((account) => account.provider === AccountProvider.PASSWORD),
    };
  }

  async unlinkGoogle(userId: string) {
    return this.db.$transaction(async (tx) => {
      const google = await tx.account.findFirst({
        where: { userId, provider: GOOGLE_PROVIDER },
        select: { id: true },
      });
      if (!google) return 'missing' as const;
      const count = await tx.account.count({ where: { userId } });
      if (count <= 1) return 'last' as const;
      await tx.account.delete({ where: { id: google.id } });
      return 'removed' as const;
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
      data: { revokedAt: new Date(), documentsUnlockedAt: null },
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
