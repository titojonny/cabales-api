import type { DocumentAccessLevel, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';

export const documentView = {
  id: true,
  name: true,
  mimeType: true,
  sizeBytes: true,
  groupId: true,
  eventId: true,
  expenseId: true,
  settlementId: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  owner: { select: { id: true, displayName: true } },
} as const;

export type DocumentRow = Prisma.DocumentGetPayload<{ select: typeof documentView }>;

/** Persistencia de metadatos de documentos, permisos y bitácora de acceso. */
export class DocumentsRepository {
  constructor(private readonly db: Database) {}

  find(id: string) {
    return this.db.document.findUnique({
      where: { id },
      select: { ...documentView, storageKey: true },
    });
  }

  grantFor(documentId: string, userId: string) {
    return this.db.documentAccessGrant.findUnique({
      where: { documentId_userId: { documentId, userId } },
      select: { access: true },
    });
  }

  entityInGroup(kind: 'event' | 'expense' | 'settlement', id: string, groupId: string) {
    const where = { id, groupId };
    if (kind === 'event') return this.db.event.findFirst({ where, select: { id: true } });
    if (kind === 'expense') return this.db.expense.findFirst({ where, select: { id: true } });
    return this.db.settlement.findFirst({ where, select: { id: true } });
  }

  create(data: {
    ownerId: string;
    name: string;
    storageKey: string;
    mimeType: string;
    sizeBytes: number;
    checksumSha256: string;
    groupId?: string;
    eventId?: string;
    expenseId?: string;
    settlementId?: string;
    requestId: string;
  }) {
    const { requestId, ...document } = data;
    return this.db.$transaction(async (tx) => {
      const created = await tx.document.create({ data: document, select: documentView });
      await tx.documentAccessLog.create({
        data: { documentId: created.id, userId: data.ownerId, action: 'upload', requestId },
      });
      return created;
    });
  }

  /** Documentos visibles: propios, compartidos explícitamente o de grupos donde es miembro. */
  list(
    userId: string,
    filters: Omit<Prisma.DocumentWhereInput, 'OR'>,
    cursor: string | undefined,
    limit: number,
  ) {
    return this.db.document.findMany({
      where: {
        ...filters,
        OR: [
          { ownerId: userId },
          { grants: { some: { userId } } },
          { group: { members: { some: { userId } } } },
        ],
      },
      select: documentView,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
  }

  update(id: string, data: Prisma.DocumentUncheckedUpdateInput, userId: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const updated = await tx.document.update({ where: { id }, data, select: documentView });
      await tx.documentAccessLog.create({
        data: { documentId: id, userId, action: 'update', requestId },
      });
      return updated;
    });
  }

  delete(id: string, userId: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const removed = await tx.document.delete({
        where: { id },
        select: { storageKey: true, name: true },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'document.deleted',
          entityType: 'Document',
          entityId: id,
          requestId,
        },
      });
      return removed;
    });
  }

  logAccess(documentId: string, userId: string, action: string, requestId: string) {
    return this.db.documentAccessLog.create({ data: { documentId, userId, action, requestId } });
  }

  listGrants(documentId: string) {
    return this.db.documentAccessGrant.findMany({
      where: { documentId },
      select: {
        userId: true,
        access: true,
        createdAt: true,
        user: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  upsertGrant(
    documentId: string,
    userId: string,
    access: DocumentAccessLevel,
    actorId: string,
    requestId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const grant = await tx.documentAccessGrant.upsert({
        where: { documentId_userId: { documentId, userId } },
        create: { documentId, userId, access },
        update: { access },
        select: {
          userId: true,
          access: true,
          createdAt: true,
          user: { select: { displayName: true } },
        },
      });
      await tx.documentAccessLog.create({
        data: { documentId, userId: actorId, action: `grant:${access}`, requestId },
      });
      return grant;
    });
  }

  deleteGrant(documentId: string, userId: string, actorId: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const removed = await tx.documentAccessGrant.deleteMany({ where: { documentId, userId } });
      if (removed.count > 0) {
        await tx.documentAccessLog.create({
          data: { documentId, userId: actorId, action: 'revoke', requestId },
        });
      }
      return removed.count;
    });
  }

  listLogs(documentId: string) {
    return this.db.documentAccessLog.findMany({
      where: { documentId },
      select: {
        id: true,
        action: true,
        createdAt: true,
        user: { select: { id: true, displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
  }
}
