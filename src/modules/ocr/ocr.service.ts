import { DocumentAccessLevel, GroupRole, OcrJobStatus, type Prisma } from '@prisma/client';
import { AppError, ensure } from '../../shared/errors.js';
import type { DomainEvents } from '../../shared/events.js';
import type { BackgroundTasks } from '../../infrastructure/background.js';
import { ExternalProviderError } from '../../infrastructure/errors.js';
import type { OcrProvider } from '../../infrastructure/ocr.js';
import type { DocumentsService } from '../documents/documents.service.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { OcrJobRow, OcrRepository } from './ocr.repository.js';

const OCR_MIME = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

/** OCR asíncrono: crea, procesa, reintenta y confirma propuestas sin tocar gastos por sí mismo. */
export class OcrService {
  constructor(
    private readonly repository: OcrRepository,
    private readonly documents: DocumentsService,
    private readonly groups: GroupsService,
    private readonly provider: OcrProvider,
    private readonly background: BackgroundTasks,
    private readonly options: { maxAttempts: number; events?: DomainEvents },
  ) {}

  private present(job: OcrJobRow) {
    const { requestedById: _requestedById, extractedData, ...rest } = job;
    return {
      ...rest,
      proposal: job.status === OcrJobStatus.SUCCEEDED ? extractedData : null,
      maxAttempts: this.options.maxAttempts,
      canRetry: job.status === OcrJobStatus.FAILED && job.attempts < this.options.maxAttempts,
      provider: this.provider.name,
    };
  }

  private async own(userId: string, jobId: string) {
    const job = await this.repository.find(jobId);
    ensure(
      job && job.requestedById === userId,
      404,
      'OCR_JOB_NOT_FOUND',
      'Trabajo OCR no encontrado',
    );
    return job;
  }

  async create(userId: string, documentId: string, requestId: string) {
    const document = await this.documents.readForProcessing(userId, documentId);
    ensure(
      OCR_MIME.has(document.mimeType),
      415,
      'UNSUPPORTED_MEDIA_TYPE',
      'El documento no admite OCR',
    );
    ensure(
      !(this.provider.name === 'tesseract' && document.mimeType === 'application/pdf'),
      415,
      'OCR_TESSERACT_PDF_UNSUPPORTED',
      'El OCR local con Tesseract no admite PDF; sube una imagen JPEG, PNG o WebP',
    );
    const job = await this.repository.create(documentId, userId, requestId);
    this.schedule(job.id, userId, document.storageKey, document.mimeType);
    return this.present(job);
  }

  async get(userId: string, jobId: string) {
    return this.present(await this.own(userId, jobId));
  }

  async list(userId: string, documentId?: string) {
    return (await this.repository.list(userId, documentId)).map((job) => this.present(job));
  }

  async retry(userId: string, jobId: string) {
    const job = await this.own(userId, jobId);
    ensure(
      job.status === OcrJobStatus.FAILED,
      409,
      'OCR_NOT_RETRYABLE',
      'Solo se reintentan trabajos fallidos',
    );
    ensure(
      job.attempts < this.options.maxAttempts,
      409,
      'OCR_MAX_ATTEMPTS',
      'Se alcanzo el maximo de intentos',
    );
    ensure(job.documentId, 409, 'OCR_NOT_RETRYABLE', 'El documento ya no existe');
    const document = await this.documents.readForProcessing(userId, job.documentId);
    const requeued = await this.repository.requeue(jobId, this.options.maxAttempts);
    ensure(requeued.count === 1, 409, 'OCR_NOT_RETRYABLE', 'El trabajo cambio de estado');
    this.schedule(jobId, userId, document.storageKey, document.mimeType);
    return this.present((await this.repository.find(jobId))!);
  }

  /** La persona elige el gasto (creado o editado por ella) al que corresponde la propuesta. */
  async confirm(userId: string, jobId: string, expenseId: string, requestId: string) {
    const job = await this.own(userId, jobId);
    if (job.confirmedAt) {
      ensure(
        job.confirmedExpenseId === expenseId,
        409,
        'OCR_ALREADY_CONFIRMED',
        'La propuesta ya se confirmo con otro gasto',
      );
      return this.present(job);
    }
    ensure(
      job.status === OcrJobStatus.SUCCEEDED,
      409,
      'OCR_NOT_READY',
      'La propuesta aun no esta lista',
    );
    ensure(job.documentId, 409, 'OCR_NOT_READY', 'El documento ya no existe');
    const expense = await this.repository.expenseGroup(expenseId);
    ensure(expense, 404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado');
    await this.groups.requireRole(userId, expense.groupId, [
      GroupRole.OWNER,
      GroupRole.ADMIN,
      GroupRole.MEMBER,
    ]);
    const document = await this.documents.readForProcessing(userId, job.documentId);
    const access = await this.documents.accessLevel(userId, document);
    const canLink =
      document.groupId === expense.groupId &&
      (access === DocumentAccessLevel.EDIT || access === DocumentAccessLevel.MANAGE);
    const confirmed = await this.repository.confirm(
      jobId,
      expenseId,
      job.documentId,
      canLink,
      userId,
      requestId,
    );
    ensure(confirmed, 409, 'OCR_ALREADY_CONFIRMED', 'La propuesta ya se confirmo');
    return this.present(confirmed);
  }

  private schedule(jobId: string, userId: string, storageKey: string, mimeType: string) {
    this.background.run('ocr.process', () => this.process(jobId, userId, storageKey, mimeType));
  }

  /** Procesa un intento; cualquier error queda como FAILED con código estable. */
  async process(jobId: string, userId: string, storageKey: string, mimeType: string) {
    if (!(await this.repository.claim(jobId))) return;
    let status: 'SUCCEEDED' | 'FAILED' = 'FAILED';
    try {
      const bytes = await this.documents.readBytes(storageKey);
      const proposal = await this.provider.extract({ bytes, mimeType });
      await this.repository.succeed(jobId, proposal as unknown as Prisma.InputJsonValue);
      status = 'SUCCEEDED';
    } catch (error) {
      const code =
        error instanceof ExternalProviderError
          ? error.code
          : error instanceof AppError
            ? error.code
            : 'PROCESSING_ERROR';
      await this.repository.fail(jobId, code);
    }
    this.options.events?.emit({ type: 'ocr.finished', jobId, userId, status });
  }
}
