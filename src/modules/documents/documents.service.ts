import { DocumentAccessLevel, GroupRole } from '@prisma/client';
import { AppError, ensure } from '../../shared/errors.js';
import { ExternalProviderError } from '../../infrastructure/errors.js';
import {
  ALLOWED_DOCUMENT_TYPES,
  newStorageKey,
  sha256,
  type FileStorageProvider,
} from '../../infrastructure/storage.js';
import type { GroupsService } from '../groups/groups.service.js';
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
    private readonly options: { maxBytes: number; signedUrlTtlSeconds: number },
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
      if (grant) level = Math.max(level, RANK[grant.access]);
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

  private present(document: DocumentRow, access: DocumentAccessLevel) {
    const {
      ownerId: _ownerId,
      storageKey: _storageKey,
      ...rest
    } = document as DocumentRow & {
      storageKey?: string;
    };
    return { ...rest, access };
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
    const storageKey = newStorageKey('documents');
    await this.storage.put(storageKey, bytes, mimeType);
    try {
      const document = await this.repository.create({
        ownerId: userId,
        name: sanitizeFileName(query.name),
        storageKey,
        mimeType,
        sizeBytes: bytes.length,
        checksumSha256: sha256(bytes),
        requestId,
        ...(query.groupId ? { groupId: query.groupId } : {}),
        ...(query.eventId ? { eventId: query.eventId } : {}),
        ...(query.expenseId ? { expenseId: query.expenseId } : {}),
        ...(query.settlementId ? { settlementId: query.settlementId } : {}),
      });
      return this.present(document, DocumentAccessLevel.MANAGE);
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
      },
      query.cursor,
      query.limit,
    );
    const page = rows.slice(0, query.limit);
    const items = [];
    for (const row of page) {
      const access = await this.accessLevel(userId, row);
      if (access) items.push(this.present(row, access));
    }
    return { items, nextCursor: rows.length > query.limit ? (page.at(-1)?.id ?? null) : null };
  }

  async detail(userId: string, documentId: string) {
    const { document, access } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    return this.present(document, access);
  }

  async update(userId: string, documentId: string, input: UpdateDocumentInput, requestId: string) {
    const { document, access } = await this.require(userId, documentId, DocumentAccessLevel.EDIT);
    await this.assertAssociations(document.groupId, input);
    const updated = await this.repository.update(
      documentId,
      {
        ...(input.name !== undefined ? { name: sanitizeFileName(input.name) } : {}),
        ...(input.eventId !== undefined ? { eventId: input.eventId } : {}),
        ...(input.expenseId !== undefined ? { expenseId: input.expenseId } : {}),
        ...(input.settlementId !== undefined ? { settlementId: input.settlementId } : {}),
      },
      userId,
      requestId,
    );
    return this.present(updated, access);
  }

  async remove(userId: string, documentId: string, requestId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    const removed = await this.repository.delete(documentId, userId, requestId);
    await this.storage.delete(removed.storageKey).catch(() => undefined);
  }

  async downloadUrl(userId: string, documentId: string, requestId: string) {
    const { document } = await this.require(userId, documentId, DocumentAccessLevel.VIEW);
    const signed = await this.storage.signedDownloadUrl(
      { key: document.storageKey, fileName: document.name, mimeType: document.mimeType },
      this.options.signedUrlTtlSeconds,
    );
    await this.repository.logAccess(documentId, userId, 'download_url', requestId);
    return signed;
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

  async listGrants(userId: string, documentId: string) {
    await this.require(userId, documentId, DocumentAccessLevel.MANAGE);
    return (await this.repository.listGrants(documentId)).map((grant) => ({
      userId: grant.userId,
      displayName: grant.user.displayName,
      access: grant.access,
      createdAt: grant.createdAt,
    }));
  }

  async grant(
    userId: string,
    documentId: string,
    granteeId: string,
    access: DocumentAccessLevel,
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
    const grant = await this.repository.upsertGrant(
      documentId,
      granteeId,
      access,
      userId,
      requestId,
    );
    return {
      userId: grant.userId,
      displayName: grant.user.displayName,
      access: grant.access,
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
}
