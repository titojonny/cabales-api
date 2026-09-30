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

const invitationView = {
  id: true,
  groupId: true,
  email: true,
  role: true,
  status: true,
  expiresAt: true,
  createdAt: true,
  acceptedAt: true,
  revokedAt: true,
  lastSentAt: true,
  sendCount: true,
  invitedBy: { select: { id: true, displayName: true } },
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
      take: 100,
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
            user: { select: { id: true, displayName: true, avatarUrl: true } },
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

  groupSummary(groupId: string) {
    return this.db.group.findUnique({ where: { id: groupId }, select: { id: true, name: true } });
  }

  userDisplayName(userId: string) {
    return this.db.user.findUnique({ where: { id: userId }, select: { displayName: true } });
  }

  isMemberEmail(groupId: string, email: string) {
    return this.db.groupMember.findFirst({
      where: { groupId, user: { email } },
      select: { id: true },
    });
  }

  /** Marca como EXPIRED las invitaciones pendientes vencidas del grupo antes de decidir. */
  expireStale(groupId?: string) {
    return this.db.groupInvitation.updateMany({
      where: {
        status: InvitationStatus.PENDING,
        expiresAt: { lte: new Date() },
        ...(groupId ? { groupId } : {}),
      },
      data: { status: InvitationStatus.EXPIRED },
    });
  }

  findPendingByEmail(groupId: string, email: string) {
    return this.db.groupInvitation.findFirst({
      where: { groupId, email, status: InvitationStatus.PENDING, expiresAt: { gt: new Date() } },
      select: { id: true },
    });
  }

  createInvitation(input: {
    groupId: string;
    invitedById: string;
    email: string;
    role: GroupRole;
    tokenHash: string;
    expiresAt: Date;
    requestId: string;
  }) {
    const { requestId, ...data } = input;
    return this.db.$transaction(async (tx) => {
      const invitation = await tx.groupInvitation.create({
        data: { ...data, lastSentAt: new Date() },
        select: invitationView,
      });
      await tx.auditLog.create({
        data: {
          userId: input.invitedById,
          action: 'invitation.created',
          entityType: 'GroupInvitation',
          entityId: invitation.id,
          requestId,
          metadata: { groupId: input.groupId, role: input.role },
        },
      });
      return invitation;
    });
  }

  reopenExpired(invitationId: string) {
    return this.db.groupInvitation.updateMany({
      where: { id: invitationId, status: InvitationStatus.EXPIRED },
      data: { status: InvitationStatus.PENDING },
    });
  }

  listInvitations(groupId: string, status?: InvitationStatus) {
    return this.db.groupInvitation.findMany({
      where: { groupId, ...(status ? { status } : {}) },
      select: invitationView,
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }

  findInvitationInGroup(groupId: string, invitationId: string) {
    return this.db.groupInvitation.findFirst({
      where: { id: invitationId, groupId },
      select: invitationView,
    });
  }

  /** Rota el token (el anterior deja de servir) y extiende la vigencia de una invitación pendiente. */
  async rotateInvitation(input: {
    invitationId: string;
    tokenHash: string;
    expiresAt: Date;
    userId: string;
    requestId: string;
  }) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.groupInvitation.updateMany({
        where: { id: input.invitationId, status: InvitationStatus.PENDING },
        data: {
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          lastSentAt: new Date(),
          sendCount: { increment: 1 },
        },
      });
      if (updated.count !== 1) return null;
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: 'invitation.resent',
          entityType: 'GroupInvitation',
          entityId: input.invitationId,
          requestId: input.requestId,
        },
      });
      return tx.groupInvitation.findUnique({
        where: { id: input.invitationId },
        select: invitationView,
      });
    });
  }

  async revokeInvitation(invitationId: string, userId: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.groupInvitation.updateMany({
        where: { id: invitationId, status: InvitationStatus.PENDING },
        data: { status: InvitationStatus.REVOKED, revokedAt: new Date(), revokedById: userId },
      });
      if (updated.count !== 1) return null;
      await tx.auditLog.create({
        data: {
          userId,
          action: 'invitation.revoked',
          entityType: 'GroupInvitation',
          entityId: invitationId,
          requestId,
        },
      });
      return tx.groupInvitation.findUnique({ where: { id: invitationId }, select: invitationView });
    });
  }

  findInvitation(tokenHash: string) {
    return this.db.groupInvitation.findUnique({
      where: { tokenHash },
      select: {
        id: true,
        groupId: true,
        email: true,
        role: true,
        status: true,
        expiresAt: true,
        invitedById: true,
        group: { select: { name: true } },
        invitedBy: { select: { displayName: true } },
      },
    });
  }

  /** Reclama la invitación con update condicional antes de crear la membresía. */
  acceptInvitation(
    invitationId: string,
    groupId: string,
    userId: string,
    role: GroupRole,
    requestId: string,
  ) {
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
      const membership = await tx.groupMember.upsert({
        where: { groupId_userId: { groupId, userId } },
        create: { groupId, userId, role },
        update: {},
        select: { id: true, groupId: true, role: true, joinedAt: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'invitation.accepted',
          entityType: 'GroupInvitation',
          entityId: invitationId,
          requestId,
          metadata: { groupId },
        },
      });
      return membership;
    });
  }

  listCategories(groupId: string) {
    return this.db.category.findMany({
      where: { OR: [{ groupId }, { groupId: null }] },
      select: { id: true, groupId: true, name: true, color: true },
      orderBy: [{ groupId: 'asc' }, { name: 'asc' }],
      take: 200,
    });
  }

  createCategory(groupId: string, input: { name: string; color?: string | undefined }) {
    return this.db.category.create({
      data: { groupId, name: input.name, ...(input.color ? { color: input.color } : {}) },
      select: { id: true, groupId: true, name: true, color: true },
    });
  }

  deleteCategory(groupId: string, categoryId: string) {
    return this.db.category.deleteMany({ where: { id: categoryId, groupId } });
  }

  findCategory(groupId: string, categoryId: string) {
    return this.db.category.findFirst({
      where: { id: categoryId, OR: [{ groupId }, { groupId: null }] },
      select: { id: true },
    });
  }
}
