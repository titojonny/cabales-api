import { DocumentAccessLevel, GroupRole } from '@prisma/client';
import { Readable } from 'node:stream';
import { hashToken, randomToken } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import { ExternalProviderError } from '../../infrastructure/errors.js';
import {
  ALLOWED_DOCUMENT_TYPES,
  newStorageKey,
  sha256,
  type FileStorageProvider,
} from '../../infrastructure/storage.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { NotificationsService } from '../notifications/notifications.service.js';
import type { DocumentEncryption } from './document-encryption.js';
import type { DocumentRow, DocumentsRepository } from './documents.repository.js';
import type { ListDocumentsQuery, UpdateDocumentInput, UploadQuery } from './documents.schema.js';

const RANK: Record<DocumentAccessLevel, number> = { VIEW: 1, EDIT: 2, MANAGE: 3 };

/** Nombre visible seguro: sin rutas, controles ni caracteres problemáticos para cabeceras. */
export function sanitizeFileName(name: string): string {
  const cleaned = name
    .normalize('NFC')
    // Elimina deliberadamente caracteres de control, que romperían Content-Disposition.
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f"\\/<>:|?*]/g, '_')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 255);
  return cleaned || 'documento';
}

/** Content-Disposition RFC 6266/5987 con respaldo ASCII. */
export function contentDisposition(fileName: string): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(fileName)}`;
}

/** Biblioteca de documentos con permisos VIEW|EDIT|MANAGE y validación de contenido. */
export class DocumentsService {
  constructor(
    private readonly repository: DocumentsRepository,
    private readonly groups: GroupsService,
    private readonly storage: FileStorageProvider,
    private readonly options: {
      maxBytes: number;
      signedUrlTtlSeconds: number;
      encryption?: DocumentEncryption;
      requireEncryption?: boolean;
      publicApiOrigin?: string;
      publicShareOrigin?: string;
      s3Sse?: 'AES256' | 'aws:kms';
      s3SseKmsKeyId?: string;
    },
  ) {}

  /** Nivel efectivo: propietario, concesión explícita o rol en el grupo del documento. */
  async accessLevel(userId: string, document: Pick<DocumentRow, 'id' | 'ownerId' | 'groupId'>) {
    let level = 0;
    if (document.ownerId === userId) level = RANK.MANAGE;
    let membership: Awaited<ReturnType<GroupsService['requireRole']>> | null = null;
    if (document.groupId) {
      try {
        membership = await this.groups.requireRole(userId, document.groupId, [
          GroupRole.OWNER,
          GroupRole.ADMIN,
          GroupRole.MEMBER,
        ]);
      } catch (error) {
        if (!(error instanceof AppError) || error.code !== 'GROUP_NOT_FOUND') throw error;
      }
    }
    // Las concesiones de un documento de grupo dejan de ser válidas al salir del grupo.
    if (membership || !document.groupId) {
      const grant = await this.repository.grantFor(document.id, userId);
      if (grant && (!grant.expiresAt || grant.expiresAt.getTime() > Date.now()))
        level = Math.max(level, RANK[grant.access]);
    }
    if (membership && level < RANK.MANAGE) {
      level = Math.max(level, membership.role === GroupRole.MEMBER ? RANK.VIEW : RANK.MANAGE);
    }
    return (Object.keys(RANK) as DocumentAccessLevel[]).find((key) => RANK[key] === level) ?? null;
  }

  /** Carga el documento y exige un nivel mínimo; sin acceso responde 404 para no revelar existencia. */
  private async require(userId: string, documentId: string, minimum: DocumentAccessLevel) {
    const document = await this.repository.find(documentId);
    ensure(document, 404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado');
    const access = await this.accessLevel(userId, document);
    ensure(access, 404, 'DOCUMENT_NOT_FOUND', 'Documento no encontrado');
    if (RANK[access] < RANK[minimum]) {
      throw new AppError(
        403,
        'DOCUMENT_FORBIDDEN',
        'Tu permiso sobre el documento no permite esta accion',
      );
    }
    return { document, access };
  }

  private present(document: DocumentRow, access: DocumentAccessLevel, userId?: string) {
    const {
      ownerId: _ownerId,
      storageKey: _storageKey,
      encryptionKeyId: _encryptionKeyId,
      encryptionIv: _encryptionIv,
      encryptionTag: _encryptionTag,
      wrappedDataKey: _wrappedDataKey,
      pins: _pins,
      ...rest
    } = document as DocumentRow & {
      storageKey?: string;
      pins?: Array<{ userId: string }>;
    };
    return { ...rest, access, isPinned: Boolean(userId && _pins?.some((pin) => pin.userId === userId)) };
  }

  private async assertAssociations(
    groupId: string | null | undefined,
    links: {
      eventId?: string | null | undefined;
      expenseId?: string | null | undefined;
      settlementId?: string | null | undefined;
    },
  ) {
    const pairs = [
      ['event', links.eventId],
      ['expense', links.expenseId],
      ['settlement', links.settlementId],
    ] as const;
    for (const [kind, id] of pairs) {
      if (!id) continue;
      ensure(groupId, 422, 'DOCUMENT_GROUP_REQUIRED', 'Asocia primero el documento a un grupo');
      ensure(
        await this.repository.entityInGroup(kind, id, groupId),
        422,
        'ASSOCIATION_OUTSIDE_GROUP',
        'La asociacion no pertenece al grupo del documento',
      );
    }
  }

  async upload(
    userId: string,
    query: UploadQuery,
    mimeType: string,
    body: unknown,
    requestId: string,
  ) {
    ensure(Buffer.isBuffer(body) && body.length > 0, 400, 'EMPTY_UPLOAD', 'El archivo esta vacio');
    const bytes = body as Buffer;
    ensure(
      bytes.length <= this.options.maxBytes,
      413,
      'PAYLOAD_TOO_LARGE',
      'El archivo excede el limite permitido',
    );
    const detector = ALLOWED_DOCUMENT_TYPES[mimeType];
    ensure(detector, 415, 'UNSUPPORTED_MEDIA_TYPE', 'Solo se admiten PDF, JPEG, PNG o WebP');
    ensure(
      detector(bytes),
      415,
      'CONTENT_MISMATCH',
      'El contenido no coincide con el tipo declarado',
    );
    if (query.groupId) {
      await this.groups.requireRole(userId, query.groupId, [
        GroupRole.OWNER,
        GroupRole.ADMIN,
        GroupRole.MEMBER,
      ]);
    }
    await this.assertAssociations(query.groupId, query);
    if (query.expiresAt)
      ensure(new Date(query.expiresAt).getTime() > Date.now(), 422, 'DOCUMENT_EXPIRY', 'La caducidad debe estar en el futuro');
    const storageKey = newStorageKey('documents');
    const encrypted = this.options.encryption?.enabled;
    ensure(
      encrypted || !this.options.requireEncryption,
      503,
      'DOCUMENT_ENCRYPTION_REQUIRED',
      'El cifrado de documentos es obligatorio en este servidor',
    );
    const payload = encrypted ? this.options.encryption!.encrypt(bytes) : undefined;
    await this.storage.put(
      storageKey,
      payload?.ciphertext ?? bytes,
      mimeType,
      this.options.s3Sse
        ? {
            serverSideEncryption: this.options.s3Sse,
            ...(this.options.s3SseKmsKeyId ? { kmsKeyId: this.options.s3SseKmsKeyId } : {}),
          }
        : undefined,
    );
    try {
      const document = await this.repository.create({
        ownerId: userId,
        name: sanitizeFileName(query.name),
        storageKey,
        mimeType,
        sizeBytes: bytes.length,
        checksumSha256: sha256(bytes),
        category: query.category,
        expiresAt: query.expiresAt ? new Date(query.expiresAt) : null,
        expiryNoticeDays: query.expiryNoticeDays ?? [30, 7],
        isLegacy: !payload,
        ...(payload
          ? {
              encryptionKeyId: payload.keyId,
              encryptionIv: payload.iv,
              encryptionTag: payload.tag,
              wrappedDataKey: payload.wrappedDataKey,
            }
          : {}),
        requestId,
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.eventId ? { eventId: query.eventId } : {}),
        ...(query.expenseId ? { expenseId: query.expenseId } : {}),
        ...(query.settlementId ? { settlementId: query.settlementId } : {}),
      });
      return this.present(document, DocumentAccessLevel.MANAGE, userId);
    } catch (error) {
      // Compensación: no dejar objetos huérfanos si falla el registro de metadatos.
      await this.storage.delete(storageKey).catch(() => undefined);
      throw error;
    }
  }

  async list(userId: string, query: ListDocumentsQuery) {
    if (query.groupId) {
      await this.groups.requireRole(userId, query.groupId, [
        GroupRole.OWNER,
        GroupRole.ADMIN,
        GroupRole.MEMBER,
      ]);
    }
    const rows = await this.repository.list(
      userId,
      {
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.eventId ? { eventId: query.eventId } : {}),
        ...(query.expenseId ? { expenseId: query.expenseId } : {}),
        ...(query.settlementId ? { settlementId: query.settlementId } : {}),
        ...(query.category ? { category: query.category } : {}),
      },
      query.cursor,
      query.limit,
      query.pinned ? userId : undefined,
      query.recent ? new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) : undefined,
    );
    const page = rows.slice(0, query.limit);
    const items = [];
    for (const row of page) {
      const access = await this.accessLevel(userId, row);
      if (access) items.push(this.present(row, access, userId));
    }
    return { items, nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
  }

  async detail(userId: string, documentId: string) {
    const { document, access } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    return this.present(document, access, userId);
  }

  async update(userId: string, documentId: string, input: UpdateDocumentInput, requestId: string) {
    const { document, access } = await this.require(userId, documentId, DocumentAccessLevel.EDIT);
    await this.assertAssociations(document.groupId, input);
    if (input.expiresAt)
      ensure(new Date(input.expiresAt).getTime() > Date.now(), 422, 'DOCUMENT_EXPIRY', 'La caducidad debe estar en el futuro');
    const updated = await this.repository.update(
      documentId,
      {
        ...(input.name !== undefined ? { name: sanitizeFileName(input.name) } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
        ...(input.expenseId !== undefined ? { expenseId: input.expenseId } : {}),
        ...(input.settlementId !== undefined ? { settlementId: input.settlementId } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
        ...(input.expiryNoticeDays !== undefined ? { expiryNoticeDays: input.expiryNoticeDays } : {}),
      },
      userId,
      requestId,
    );
    return this.present(updated, access, userId);
  }

  async remove(userId: string, documentId: string, requestId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    const removed = await this.repository.delete(documentId, userId, requestId);
    await this.storage.delete(removed.storageKey).catch(() => undefined);
  }

  async downloadUrl(userId: string, documentId: string, requestId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    await this.repository.logAccess(documentId, userId, 'download_url', requestId);
    return {
      url: `${this.options.publicApiOrigin ?? ''}/api/v1/documents/${encodeURIComponent(documentId)}/download`,
      expiresAt: new Date(Date.now() + this.options.signedUrlTtlSeconds * 1000),
    };
  }

  async download(userId: string, documentId: string, requestId: string) {
    const { document } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    const bytes = await this.readDocumentBytes(document);
    await this.repository.logAccess(documentId, userId, 'download', requestId);
    return { document, bytes };
  }

  async downloadStream(userId: string, documentId: string, requestId: string) {
    const { document } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    const stream = await this.readDocumentStream(document);
    await this.repository.logAccess(documentId, userId, 'download', requestId);
    return { document, stream };
  }

  /** Lectura interna para OCR; exige al menos VIEW. */
  async readForProcessing(userId: string, documentId: string) {
    const { document } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    return document;
  }

  async readBytes(storageKey: string) {
    try {
      return await this.storage.get(storageKey);
    } catch (error) {
      if (error instanceof ExternalProviderError)
        throw new AppError(404, 'FILE_NOT_FOUND', 'Archivo no disponible');
      throw error;
    }
  }

  private async readDocumentBytes(document: DocumentRow & { storageKey: string }) {
    const ciphertext = await this.readBytes(document.storageKey);
    if (document.isLegacy) return ciphertext;
    ensure(
      this.options.encryption,
      503,
      'DOCUMENT_ENCRYPTION_UNAVAILABLE',
      'El cifrado de documentos no esta configurado',
    );
    return this.options.encryption.decrypt({
      ciphertext,
      keyId: document.encryptionKeyId,
      iv: document.encryptionIv,
      tag: document.encryptionTag,
      wrappedDataKey: document.wrappedDataKey,
      isLegacy: document.isLegacy,
    });
  }

  private async readDocumentStream(document: DocumentRow & { storageKey: string }) {
    const source = this.storage.getStream
      ? await this.storage.getStream(document.storageKey)
      : Readable.from([await this.readBytes(document.storageKey)]);
    if (document.isLegacy) return source;
    ensure(
      this.options.encryption,
      503,
      'DOCUMENT_ENCRYPTION_UNAVAILABLE',
      'El cifrado de documentos no esta configurado',
    );
    return source.pipe(
      this.options.encryption.createDecipher({
        keyId: document.encryptionKeyId,
        iv: document.encryptionIv,
        tag: document.encryptionTag,
        wrappedDataKey: document.wrappedDataKey,
      }),
    );
  }

  async readDocumentForProcessing(userId: string, documentId: string) {
    const { document } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    return { document, bytes: await this.readDocumentBytes(document) };
  }

  async listGrants(userId: string, documentId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    return (await this.repository.listGrants(documentId)).map((grant) => ({
      userId: grant.userId,
      displayName: grant.user.displayName,
      access: grant.access,
      expiresAt: grant.expiresAt,
      createdAt: grant.createdAt,
    }));
  }

  async grant(
    userId: string,
    documentId: string,
    granteeId: string,
    access: DocumentAccessLevel,
    expiresAt: Date | null | undefined,
    requestId: string,
  ) {
    const { document } = await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    ensure(
      document.groupId,
      422,
      'DOCUMENT_GROUP_REQUIRED',
      'Solo se comparten documentos asociados a un grupo',
    );
    ensure(
      granteeId !== document.ownerId,
      422,
      'GRANT_OWNER',
      'El propietario ya tiene control total',
    );
    let membership: Awaited<ReturnType<GroupsService['requireRole']>> | null = null;
    try {
      membership = await this.groups.requireRole(granteeId, document.groupId, [
        GroupRole.OWNER,
        GroupRole.ADMIN,
        GroupRole.MEMBER,
      ]);
    } catch (error) {
      if (!(error instanceof AppError) || error.code !== 'GROUP_NOT_FOUND') throw error;
    }
    ensure(
      membership,
      422,
      'GRANTEE_OUTSIDE_GROUP',
      'La persona no pertenece al grupo del documento',
    );
    if (expiresAt)
      ensure(expiresAt.getTime() > Date.now(), 422, 'GRANT_EXPIRY', 'La caducidad debe estar en el futuro');
    const grant = await this.repository.upsertGrant(
      documentId,
      granteeId,
      access,
      expiresAt,
      userId,
      requestId,
    );
    return {
      userId: grant.userId,
      displayName: grant.user.displayName,
      access: grant.access,
      expiresAt: grant.expiresAt,
      createdAt: grant.createdAt,
    };
  }

  async revoke(userId: string, documentId: string, granteeId: string, requestId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    const removed = await this.repository.deleteGrant(documentId, granteeId, userId, requestId);
    ensure(removed > 0, 404, 'GRANT_NOT_FOUND', 'Permiso no encontrado');
  }

  async logs(userId: string, documentId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    return this.repository.listLogs(documentId);
  }

  async pin(userId: string, documentId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    await this.repository.pin(documentId, userId);
    return { pinned: true };
  }

  async unpin(userId: string, documentId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    await this.repository.unpin(documentId, userId);
    return { pinned: false };
  }

  async createSharedLink(
    userId: string,
    documentId: string,
    input: { expiresAt: string; maxAccesses?: number },
  ) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    const expiresAt = new Date(input.expiresAt);
    ensure(
      expiresAt.getTime() > Date.now(),
      422,
      'SHARED_LINK_EXPIRY',
      'La caducidad debe estar en el futuro',
    );
    ensure(
      expiresAt.getTime() <= Date.now() + 30 * 24 * 60 * 60 * 1000,
      422,
      'SHARED_LINK_EXPIRY',
      'El enlace no puede durar mas de 30 dias',
    );
    const token = randomToken();
    const link = await this.repository.createSharedLink({
      documentId,
      createdById: userId,
      tokenHash: hashToken(token),
      expiresAt,
      ...(input.maxAccesses !== undefined ? { maxAccesses: input.maxAccesses } : {}),
    });
    return {
      ...link,
      url: `${this.options.publicShareOrigin ?? this.options.publicApiOrigin ?? ''}/share/documents/${encodeURIComponent(token)}`,
    };
  }

  async sharedLinks(userId: string, documentId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    return this.repository.listSharedLinks(documentId);
  }

  async revokeSharedLink(userId: string, documentId: string, linkId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    ensure(
      (await this.repository.revokeSharedLink(documentId, linkId)).count === 1,
      404,
      'SHARED_LINK_NOT_FOUND',
      'Enlace no encontrado',
    );
    return { revoked: true };
  }

  async sharedPreview(token: string) {
    const link = await this.repository.findSharedLink(hashToken(token), new Date());
    ensure(link, 404, 'SHARED_LINK_INVALID', 'El enlace no existe, caduco o fue revocado');
    ensure(
      link.maxAccesses === null || link.accessCount < link.maxAccesses,
      404,
      'SHARED_LINK_INVALID',
      'El enlace no existe, caduco o fue revocado',
    );
    // La consulta pública no devuelve propietario, grupo, asociaciones ni identificadores.
    return { name: link.document.name };
  }

  async sharedDownload(token: string, requestId: string) {
    const consumed = await this.repository.consumeSharedLink(hashToken(token), new Date());
    ensure(consumed, 404, 'SHARED_LINK_INVALID', 'El enlace no existe, caduco o fue revocado');
    const bytes = await this.readDocumentBytes(consumed.document);
    await this.repository.logPublicAccess(consumed.document.id, 'shared_download', requestId);
    return { document: consumed.document, bytes };
  }

  async sharedDownloadStream(token: string, requestId: string) {
    const consumed = await this.repository.consumeSharedLink(hashToken(token), new Date());
    ensure(consumed, 404, 'SHARED_LINK_INVALID', 'El enlace no existe, caduco o fue revocado');
    const stream = await this.readDocumentStream(consumed.document);
    await this.repository.logPublicAccess(consumed.document.id, 'shared_download', requestId);
    return { document: consumed.document, stream };
  }

  async runExpiryNotifications(now: Date, notifications: NotificationsService) {
    const documents = await this.repository.findExpiring(now);
    for (const document of documents) {
      if (!document.expiresAt) continue;
      const recipients = [
        document.ownerId,
        ...document.grants.map((grant) => grant.userId),
        ...(document.group?.members.map((member) => member.userId) ?? []),
      ];
      if (document.expiresAt <= now) {
        await notifications.notify({
          userIds: recipients,
          type: 'document.expired',
          title: `Documento vencido: ${document.name}`,
          body: 'Este documento ya supero su fecha de vencimiento.',
          data: { documentId: document.id, expiresAt: document.expiresAt.toISOString() },
          dedupeKey: `document:${document.id}:expired`,
        });
        continue;
      }
      for (const days of document.expiryNoticeDays) {
        const threshold = new Date(document.expiresAt.getTime() - days * 24 * 60 * 60 * 1000);
        if (now >= threshold) {
          await notifications.notify({
            userIds: recipients,
            type: 'document.expiring',
            title: `Documento por vencer: ${document.name}`,
            body: `Vence el ${document.expiresAt.toLocaleDateString('es-ES')} (aviso de ${days} dias).`,
            data: { documentId: document.id, expiresAt: document.expiresAt.toISOString(), days },
            dedupeKey: `document:${document.id}:expiring:${days}`,
          });
        }
      }
    }
  }
}
