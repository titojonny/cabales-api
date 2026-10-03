import { PrivacyRequestStatus, PrivacyRequestType } from '@prisma/client';
import { AppError, ensure } from '../../shared/errors.js';
import type { DomainEvents } from '../../shared/events.js';
import type { BackgroundTasks } from '../../infrastructure/background.js';
import type { FileStorageProvider } from '../../infrastructure/storage.js';
import type { AuthPort } from '../auth/auth.service.js';
import type { ConfirmPrivacyRequestInput, CreatePrivacyRequestInput } from './privacy.schema.js';
import type { PrivacyRepository, PrivacyRequestView } from './privacy.repository.js';

const EXPORTABLE: PrivacyRequestType[] = [
  PrivacyRequestType.ACCESS,
  PrivacyRequestType.PORTABILITY,
];

/** Ciclo de vida ARCO-POL: solicitud, confirmación, exportación, supresión y cancelación. */
export class PrivacyService {
  constructor(
    private readonly repository: PrivacyRepository,
    private readonly auth: Pick<AuthPort, 'verifyPassword'>,
    private readonly options: {
      exportTtlMs: number;
      storage?: FileStorageProvider;
      background?: BackgroundTasks;
      events?: DomainEvents;
    },
  ) {}

  async create(userId: string, input: CreatePrivacyRequestInput, requestId: string) {
    const type = input.type as PrivacyRequestType;
    ensure(
      !(await this.repository.findOpenOfType(userId, type)),
      409,
      'PRIVACY_REQUEST_OPEN',
      'Ya tienes una solicitud abierta de este tipo',
    );
    const created = await this.repository.create(userId, type, input.reason, requestId);
    return this.present(created);
  }

  async list(userId: string) {
    return (await this.repository.list(userId)).map((request) => this.present(request));
  }

  async get(userId: string, id: string) {
    const request = await this.repository.get(userId, id);
    ensure(request, 404, 'PRIVACY_REQUEST_NOT_FOUND', 'Solicitud no encontrada');
    return this.present(request);
  }

  async confirm(userId: string, id: string, input: ConfirmPrivacyRequestInput, requestId: string) {
    const current = await this.repository.get(userId, id);
    ensure(current, 404, 'PRIVACY_REQUEST_NOT_FOUND', 'Solicitud no encontrada');
    ensure(
      current.status === PrivacyRequestStatus.PENDING,
      409,
      'PRIVACY_REQUEST_STATE',
      'La solicitud ya no admite confirmacion',
    );
    let updated: PrivacyRequestView | null;
    if (EXPORTABLE.includes(current.type)) {
      const now = new Date();
      updated = await this.repository.transition({
        userId,
        id,
        from: [PrivacyRequestStatus.PENDING],
        to: PrivacyRequestStatus.COMPLETED,
        requestId,
        data: {
          confirmedAt: now,
          completedAt: now,
          exportExpiresAt: new Date(now.getTime() + this.options.exportTtlMs),
        },
      });
    } else if (current.type === PrivacyRequestType.ERASURE) {
      ensure(input.password, 400, 'REAUTH_REQUIRED', 'Confirma la supresion con tu contrasena');
      const valid = await this.auth.verifyPassword(userId, input.password);
      ensure(valid, 403, 'REAUTH_FAILED', 'La contrasena no es correcta');
      const result = await this.repository.eraseUser(userId, id, requestId);
      const { storage, background } = this.options;
      if (storage && background && result.storageKeys.length > 0) {
        background.run('privacy.erase_files', async () => {
          for (const key of result.storageKeys) await storage.delete(key);
        });
      }
      updated = await this.repository.get(userId, id);
    } else {
      // Rectificación u oposición requieren revisión del responsable; quedan en curso y auditadas.
      updated = await this.repository.transition({
        userId,
        id,
        from: [PrivacyRequestStatus.PENDING],
        to: PrivacyRequestStatus.IN_PROGRESS,
        requestId,
        data: { confirmedAt: new Date() },
      });
    }
    ensure(
      updated,
      409,
      'PRIVACY_REQUEST_STATE',
      'La solicitud cambio de estado; recarga e intenta de nuevo',
    );
    if (current.type !== PrivacyRequestType.ERASURE) {
      this.options.events?.emit({
        type: 'privacy.updated',
        userId,
        privacyRequestId: id,
        status: updated.status,
        requestType: updated.type,
      });
    }
    return this.present(updated);
  }

  async cancel(userId: string, id: string, requestId: string) {
    const current = await this.repository.get(userId, id);
    ensure(current, 404, 'PRIVACY_REQUEST_NOT_FOUND', 'Solicitud no encontrada');
    const updated = await this.repository.transition({
      userId,
      id,
      from: [PrivacyRequestStatus.PENDING, PrivacyRequestStatus.IN_PROGRESS],
      to: PrivacyRequestStatus.CANCELLED,
      requestId,
      data: { cancelledAt: new Date() },
    });
    ensure(
      updated,
      409,
      'PRIVACY_REQUEST_STATE',
      'Solo se cancelan solicitudes pendientes o en curso',
    );
    return this.present(updated);
  }

  /** Genera la exportación bajo demanda (no se almacena) mientras siga vigente. */
  async export(userId: string, id: string, requestId: string) {
    const current = await this.repository.get(userId, id);
    ensure(current, 404, 'PRIVACY_REQUEST_NOT_FOUND', 'Solicitud no encontrada');
    ensure(
      EXPORTABLE.includes(current.type),
      409,
      'EXPORT_NOT_AVAILABLE',
      'Esta solicitud no genera exportacion',
    );
    ensure(
      current.status === PrivacyRequestStatus.COMPLETED,
      409,
      'EXPORT_NOT_AVAILABLE',
      'Confirma la solicitud para generar la exportacion',
    );
    if (!current.exportExpiresAt || current.exportExpiresAt.getTime() <= Date.now()) {
      throw new AppError(410, 'EXPORT_EXPIRED', 'La exportacion vencio; crea una solicitud nueva');
    }
    const data = await this.repository.exportData(userId);
    await this.repository.logExport(userId, id, requestId);
    return data;
  }

  private present(request: PrivacyRequestView) {
    const exportAvailable =
      EXPORTABLE.includes(request.type) &&
      request.status === PrivacyRequestStatus.COMPLETED &&
      request.exportExpiresAt !== null &&
      request.exportExpiresAt.getTime() > Date.now();
    return {
      ...request,
      exportAvailable,
      requiresPassword: request.type === PrivacyRequestType.ERASURE,
    };
  }
}
