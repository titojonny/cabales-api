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
