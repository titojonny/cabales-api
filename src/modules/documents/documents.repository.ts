import type { DocumentAccessLevel, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';

export const documentView = {
  id: true,
  name: true,
  category: true,
  expiresAt: true,
  expiryNoticeDays: true,
  mimeType: true,
  sizeBytes: true,
  groupId: true,
  eventId: true,
  expenseId: true,
  settlementId: true,
  ownerId: true,
  createdAt: true,
  updatedAt: true,
  lastAccessedAt: true,
  isLegacy: true,
  encryptionKeyId: true,
  encryptionIv: true,
  encryptionTag: true,
  wrappedDataKey: true,
  owner: { select: { id: true, displayName: true } },
  pins: { select: { userId: true } },
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
      select: { access: true, expiresAt: true },
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
    category: 'IDENTIDAD' | 'VIAJE' | 'SEGURO' | 'VEHICULO' | 'SALUD' | 'HOGAR' | 'FINANZAS' | 'OTRO';
    expiresAt?: Date | null;
    expiryNoticeDays: number[];
    isLegacy: boolean;
    encryptionKeyId?: string;
    encryptionIv?: string;
    encryptionTag?: string;
    wrappedDataKey?: string;
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
    pinnedForUserId?: string,
    recentSince?: Date,
  ) {
    return this.db.document.findMany({
      where: {
        ...filters,
        ...(pinnedForUserId ? { pins: { some: { userId: pinnedForUserId } } } : {}),
        ...(recentSince
          ? {
              AND: [
                {
                  OR: [
                    { createdAt: { gte: recentSince } },
                    { lastAccessedAt: { gte: recentSince } },
                  ],
                },
              ],
            }
          : {}),
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
    return this.db.$transaction(async (tx) => {
      const result = await tx.documentAccessLog.create({ data: { documentId, userId, action, requestId } });
      if (action === 'download' || action === 'download_url')
        await tx.document.update({ where: { id: documentId }, data: { lastAccessedAt: new Date() } });
      return result;
    });
  }

  logPublicAccess(documentId: string, action: string, requestId: string) {
    return this.db.documentAccessLog.create({ data: { documentId, action, requestId } });
  }

  listGrants(documentId: string) {
    return this.db.documentAccessGrant.findMany({
      where: { documentId },
      select: {
        userId: true,
        access: true,
        expiresAt: true,
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
    expiresAt: Date | null | undefined,
    actorId: string,
    requestId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const grant = await tx.documentAccessGrant.upsert({
        where: { documentId_userId: { documentId, userId } },
        create: { documentId, userId, access, ...(expiresAt !== undefined ? { expiresAt } : {}) },
        update: { access, ...(expiresAt !== undefined ? { expiresAt } : {}) },
        select: {
          userId: true,
          access: true,
          expiresAt: true,
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

  pin(documentId: string, userId: string) {
    return this.db.documentPin.upsert({
      where: { documentId_userId: { documentId, userId } },
      create: { documentId, userId },
      update: {},
    });
  }

  unpin(documentId: string, userId: string) {
    return this.db.documentPin.deleteMany({ where: { documentId, userId } });
  }

  listSharedLinks(documentId: string) {
    return this.db.documentSharedLink.findMany({
      where: { documentId },
      select: {
        id: true,
        expiresAt: true,
        maxAccesses: true,
        accessCount: true,
        lastAccessAt: true,
        revokedAt: true,
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  createSharedLink(input: {
    documentId: string;
    createdById: string;
    tokenHash: string;
    expiresAt: Date;
    maxAccesses?: number;
  }) {
    return this.db.documentSharedLink.create({
      data: input,
      select: { id: true, expiresAt: true, maxAccesses: true, accessCount: true, revokedAt: true, createdAt: true },
    });
  }

  revokeSharedLink(documentId: string, linkId: string) {
    return this.db.documentSharedLink.updateMany({
      where: { id: linkId, documentId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  consumeSharedLink(tokenHash: string, now: Date) {
    return this.db.$transaction(async (tx) => {
      const link = await tx.documentSharedLink.findUnique({
        where: { tokenHash },
        select: { id: true, documentId: true, maxAccesses: true, accessCount: true, expiresAt: true, revokedAt: true },
      });
      if (!link || link.revokedAt || link.expiresAt <= now) return null;
      if (link.maxAccesses !== null && link.accessCount >= link.maxAccesses) return null;
      const updated = await tx.documentSharedLink.updateMany({
        where: {
          id: link.id,
          revokedAt: null,
          expiresAt: { gt: now },
          ...(link.maxAccesses !== null ? { accessCount: { lt: link.maxAccesses } } : {}),
        },
        data: { accessCount: { increment: 1 }, lastAccessAt: now },
      });
      if (updated.count !== 1) return null;
      const document = await tx.document.findUnique({
        where: { id: link.documentId },
        select: { ...documentView, storageKey: true },
      });
      return document ? { link, document } : null;
    });
  }

  findSharedLink(tokenHash: string, now: Date) {
    return this.db.documentSharedLink.findFirst({
      where: { tokenHash, revokedAt: null, expiresAt: { gt: now } },
      select: {
        expiresAt: true,
        maxAccesses: true,
        accessCount: true,
        document: { select: { name: true } },
      },
    });
  }

  findExpiring(now: Date) {
    return this.db.document.findMany({
      where: { expiresAt: { not: null } },
      select: {
        id: true,
        name: true,
        expiresAt: true,
        expiryNoticeDays: true,
        ownerId: true,
        grants: { where: { OR: [{ expiresAt: null }, { expiresAt: { gt: now } }], }, select: { userId: true } },
        group: { select: { members: { select: { userId: true } } } },
      },
    });
  }

  updateEncryption(id: string, data: { encryptionKeyId: string; encryptionIv: string; encryptionTag: string; wrappedDataKey: string; isLegacy: boolean }) {
    return this.db.document.update({ where: { id }, data });
  }

  listForKeyRotation() {
    return this.db.document.findMany({
      select: {
        id: true,
        storageKey: true,
        mimeType: true,
        isLegacy: true,
        encryptionKeyId: true,
        encryptionIv: true,
        encryptionTag: true,
        wrappedDataKey: true,
      },
      orderBy: { createdAt: 'asc' },
    });
  }
}
