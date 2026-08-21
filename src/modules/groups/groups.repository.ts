import { GroupRole, InvitationStatus, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { withSerializableRetry } from '../../database/transaction.js';
import type { UpdateGroupInput } from './groups.schema.js';

const groupView = {
  id: true,
  name: true,
  description: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} as const;

/** Persistencia de grupos, membresías e invitaciones. */
export class GroupsRepository {
  constructor(private readonly db: Database) {}

  create(
    userId: string,
    input: { name: string; description?: string | undefined; currency: string },
  ) {
    return this.db.group.create({
      data: {
        name: input.name,
        currency: input.currency,
        ...(input.description ? { description: input.description } : {}),
        createdById: userId,
        members: { create: { userId, role: GroupRole.OWNER } },
      },
      select: groupView,
    });
  }

  list(userId: string) {
    return this.db.group.findMany({
      where: { members: { some: { userId } } },
      select: {
        ...groupView,
        members: { where: { userId }, select: { id: true, role: true } },
        _count: { select: { members: true, events: true, expenses: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  detail(groupId: string) {
    return this.db.group.findUnique({
      where: { id: groupId },
      select: {
        ...groupView,
        members: {
          select: {
            id: true,
            role: true,
            joinedAt: true,
            user: { select: { id: true, displayName: true, email: true, avatarUrl: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
  }

  membership(groupId: string, userId: string) {
    return this.db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true, groupId: true, userId: true, role: true },
    });
  }

  /** Bloquea el grupo para que moneda y primer gasto no cambien de forma concurrente. */
  updateAtomic(groupId: string, input: UpdateGroupInput) {
    const data = {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.currency !== undefined ? { currency: input.currency } : {}),
    };
    return withSerializableRetry(() =>
      this.db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ currency: string }>>(
            Prisma.sql`SELECT "currency" FROM "Group" WHERE "id" = ${groupId}::uuid FOR UPDATE`,
          );
          if (!locked[0]) return { outcome: 'NOT_FOUND' as const };
          if (input.currency && input.currency !== locked[0].currency) {
            const expenseCount = await tx.expense.count({ where: { groupId } });
            if (expenseCount > 0) return { outcome: 'CURRENCY_LOCKED' as const };
          }
          const group = await tx.group.update({ where: { id: groupId }, data, select: groupView });
          return { outcome: 'UPDATED' as const, group };
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  /** Comprueba dependencias y borra bajo el mismo bloqueo que arbitra inserciones por FK. */
  deleteEmptyAtomic(groupId: string) {
    return withSerializableRetry(() =>
      this.db.$transaction(
        async (tx) => {
          const locked = await tx.$queryRaw<Array<{ id: string }>>(
            Prisma.sql`SELECT "id" FROM "Group" WHERE "id" = ${groupId}::uuid FOR UPDATE`,
          );
          if (!locked[0]) return 'NOT_FOUND' as const;
          const events = await tx.event.count({ where: { groupId } });
          const expenses = await tx.expense.count({ where: { groupId } });
          const settlements = await tx.settlement.count({ where: { groupId } });
          if (events + expenses + settlements > 0) return 'NOT_EMPTY' as const;
          await tx.group.delete({ where: { id: groupId } });
          return 'DELETED' as const;
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      ),
    );
  }

  createInvitation(input: {
    groupId: string;
    invitedById: string;
    email: string;
    role: GroupRole;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.db.groupInvitation.create({
      data: input,
      select: { id: true, groupId: true, email: true, role: true, status: true, expiresAt: true },
    });
  }

  findInvitation(tokenHash: string) {
    return this.db.groupInvitation.findUnique({
      where: { tokenHash },
      select: { id: true, groupId: true, email: true, role: true, status: true, expiresAt: true },
    });
  }

  /** Reclama la invitación con update condicional antes de crear la membresía. */
  acceptInvitation(invitationId: string, groupId: string, userId: string, role: GroupRole) {
    return this.db.$transaction(async (tx) => {
      // updateMany funciona como claim optimista: solo una petición cambia PENDING a ACCEPTED.
      const claimed = await tx.groupInvitation.updateMany({
        where: {
          id: invitationId,
          status: InvitationStatus.PENDING,
          expiresAt: { gt: new Date() },
        },
        data: { status: InvitationStatus.ACCEPTED, acceptedById: userId, acceptedAt: new Date() },
      });
      if (claimed.count !== 1) return null;
      return tx.groupMember.upsert({
        where: { groupId_userId: { groupId, userId } },
        create: { groupId, userId, role },
        update: {},
        select: { id: true, groupId: true, role: true, joinedAt: true },
      });
    });
  }
}
