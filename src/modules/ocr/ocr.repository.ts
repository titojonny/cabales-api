import type { Prisma } from '@prisma/client';
import { OcrJobStatus } from '@prisma/client';
import type { Database } from '../../database/client.js';

export const ocrJobView = {
  id: true,
  documentId: true,
  requestedById: true,
  status: true,
  attempts: true,
  errorCode: true,
  extractedData: true,
  createdAt: true,
  startedAt: true,
  finishedAt: true,
  confirmedAt: true,
  confirmedExpenseId: true,
} as const;

export type OcrJobRow = Prisma.OcrJobGetPayload<{ select: typeof ocrJobView }>;

/** Persistencia y transiciones condicionales de trabajos OCR. */
export class OcrRepository {
  constructor(private readonly db: Database) {}

  create(documentId: string, userId: string, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const job = await tx.ocrJob.create({
        data: { documentId, requestedById: userId },
        select: ocrJobView,
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ocr.requested',
          entityType: 'OcrJob',
          entityId: job.id,
          requestId,
          metadata: { documentId },
        },
      });
      return job;
    });
  }

  find(id: string) {
    return this.db.ocrJob.findUnique({ where: { id }, select: ocrJobView });
  }

  list(userId: string, documentId?: string) {
    return this.db.ocrJob.findMany({
      where: { requestedById: userId, ...(documentId ? { documentId } : {}) },
      select: ocrJobView,
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  /** Reclama un trabajo PENDING para procesarlo exactamente una vez por intento. */
  async claim(id: string) {
    const claimed = await this.db.ocrJob.updateMany({
      where: { id, status: OcrJobStatus.PENDING },
      data: {
        status: OcrJobStatus.PROCESSING,
        startedAt: new Date(),
        attempts: { increment: 1 },
        errorCode: null,
      },
    });
    return claimed.count === 1;
  }

  succeed(id: string, extractedData: Prisma.InputJsonValue) {
    return this.db.ocrJob.updateMany({
      where: { id, status: OcrJobStatus.PROCESSING },
      data: { status: OcrJobStatus.SUCCEEDED, extractedData, finishedAt: new Date() },
    });
  }

  fail(id: string, errorCode: string) {
    return this.db.ocrJob.updateMany({
      where: { id, status: OcrJobStatus.PROCESSING },
      data: {
        status: OcrJobStatus.FAILED,
        errorCode: errorCode.slice(0, 80),
        finishedAt: new Date(),
      },
    });
  }

  requeue(id: string, maxAttempts: number) {
    return this.db.ocrJob.updateMany({
      where: { id, status: OcrJobStatus.FAILED, attempts: { lt: maxAttempts } },
      data: { status: OcrJobStatus.PENDING, finishedAt: null },
    });
  }

  expenseGroup(expenseId: string) {
    return this.db.expense.findUnique({
      where: { id: expenseId },
      select: { id: true, groupId: true, ownerUserId: true },
    });
  }

  /** Confirma una sola vez y asocia el documento al gasto elegido por la persona. */
  confirm(
    id: string,
    expenseId: string,
    documentId: string,
    linkDocument: boolean,
    userId: string,
    requestId: string,
  ) {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.ocrJob.updateMany({
        where: { id, status: OcrJobStatus.SUCCEEDED, confirmedAt: null },
        data: { confirmedAt: new Date(), confirmedExpenseId: expenseId },
      });
      if (changed.count !== 1) return null;
      if (linkDocument)
        await tx.document.update({ where: { id: documentId }, data: { expenseId } });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'ocr.confirmed',
          entityType: 'OcrJob',
          entityId: id,
          requestId,
          metadata: { expenseId },
        },
      });
      return tx.ocrJob.findUnique({ where: { id }, select: ocrJobView });
    });
  }
}
