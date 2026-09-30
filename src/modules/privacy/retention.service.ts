import type { Prisma, RetentionTrigger } from '@prisma/client';
import {
  InvitationStatus,
  NotificationStatus,
  OcrJobStatus,
  PrivacyRequestStatus,
  RetentionRunStatus,
} from '@prisma/client';
import type { Database } from '../../database/client.js';

/** Ventanas de retención en milisegundos (configurables por entorno). */
export interface RetentionPolicy {
  tokensMs: number;
  sessionsMs: number;
  invitationsMs: number;
  auditLogsMs: number;
  documentLogsMs: number;
  ocrMs: number;
  notificationsMs: number;
  privacyRequestsMs: number;
}

const STALE_OCR_MS = 15 * 60 * 1000;

/**
 * Job idempotente de retención: purga datos vencidos en una sola transacción,
 * registra la ejecución (solo conteos) y la audita. dryRun solo cuenta.
 */
export class RetentionService {
  constructor(
    private readonly db: Database,
    private readonly policy: RetentionPolicy,
  ) {}

  private filters(now: Date) {
    const before = (ms: number) => new Date(now.getTime() - ms);
    const tokenWhere = {
      createdAt: { lt: before(this.policy.tokensMs) },
      OR: [{ usedAt: { not: null } }, { expiresAt: { lt: now } }],
    };
    return {
      emailVerificationTokens: tokenWhere,
      passwordResetTokens: tokenWhere,
      sessions: {
        OR: [
          { revokedAt: { lt: before(this.policy.sessionsMs) } },
          { expiresAt: { lt: before(this.policy.sessionsMs) } },
        ],
      } satisfies Prisma.SessionWhereInput,
      invitations: {
        status: {
          in: [InvitationStatus.ACCEPTED, InvitationStatus.REVOKED, InvitationStatus.EXPIRED],
        },
        createdAt: { lt: before(this.policy.invitationsMs) },
      } satisfies Prisma.GroupInvitationWhereInput,
      idempotencyKeys: { expiresAt: { lt: now } } satisfies Prisma.IdempotencyKeyWhereInput,
      auditLogs: {
        createdAt: { lt: before(this.policy.auditLogsMs) },
      } satisfies Prisma.AuditLogWhereInput,
      documentAccessLogs: {
        createdAt: { lt: before(this.policy.documentLogsMs) },
      } satisfies Prisma.DocumentAccessLogWhereInput,
      ocrJobs: {
        status: { in: [OcrJobStatus.SUCCEEDED, OcrJobStatus.FAILED] },
        createdAt: { lt: before(this.policy.ocrMs) },
      } satisfies Prisma.OcrJobWhereInput,
      notifications: {
        status: { in: [NotificationStatus.READ, NotificationStatus.ARCHIVED] },
        createdAt: { lt: before(this.policy.notificationsMs) },
      } satisfies Prisma.NotificationWhereInput,
      privacyRequests: {
        status: {
          in: [
            PrivacyRequestStatus.COMPLETED,
            PrivacyRequestStatus.REJECTED,
            PrivacyRequestStatus.CANCELLED,
          ],
        },
        updatedAt: { lt: before(this.policy.privacyRequestsMs) },
      } satisfies Prisma.PrivacyRequestWhereInput,
    };
  }

  async run(options: {
    trigger: 'MANUAL' | 'SCHEDULED';
    dryRun: boolean;
    requestId?: string;
    now?: Date;
  }) {
    const now = options.now ?? new Date();
    const run = await this.db.retentionRun.create({
      data: { trigger: options.trigger as RetentionTrigger, dryRun: options.dryRun },
      select: { id: true },
    });
    const where = this.filters(now);
    try {
      const counts = await this.db.$transaction(
        async (tx) => {
          if (options.dryRun) {
            return {
              emailVerificationTokens: await tx.emailVerificationToken.count({
                where: where.emailVerificationTokens,
              }),
              passwordResetTokens: await tx.passwordResetToken.count({
                where: where.passwordResetTokens,
              }),
              sessions: await tx.session.count({ where: where.sessions }),
              invitations: await tx.groupInvitation.count({ where: where.invitations }),
              idempotencyKeys: await tx.idempotencyKey.count({ where: where.idempotencyKeys }),
              auditLogs: await tx.auditLog.count({ where: where.auditLogs }),
              documentAccessLogs: await tx.documentAccessLog.count({
                where: where.documentAccessLogs,
              }),
              ocrJobs: await tx.ocrJob.count({ where: where.ocrJobs }),
              notifications: await tx.notification.count({ where: where.notifications }),
              privacyRequests: await tx.privacyRequest.count({ where: where.privacyRequests }),
              expiredInvitationsMarked: 0,
              staleOcrJobsFailed: 0,
            };
          }
          const expiredInvitationsMarked = (
            await tx.groupInvitation.updateMany({
              where: { status: InvitationStatus.PENDING, expiresAt: { lte: now } },
              data: { status: InvitationStatus.EXPIRED },
            })
          ).count;
          const staleOcrJobsFailed = (
            await tx.ocrJob.updateMany({
              where: {
                status: OcrJobStatus.PROCESSING,
                startedAt: { lt: new Date(now.getTime() - STALE_OCR_MS) },
              },
              data: {
                status: OcrJobStatus.FAILED,
                errorCode: 'PROCESSING_TIMEOUT',
                finishedAt: now,
              },
            })
          ).count;
          return {
            emailVerificationTokens: (
              await tx.emailVerificationToken.deleteMany({ where: where.emailVerificationTokens })
            ).count,
            passwordResetTokens: (
              await tx.passwordResetToken.deleteMany({ where: where.passwordResetTokens })
            ).count,
            sessions: (await tx.session.deleteMany({ where: where.sessions })).count,
            invitations: (await tx.groupInvitation.deleteMany({ where: where.invitations })).count,
            idempotencyKeys: (await tx.idempotencyKey.deleteMany({ where: where.idempotencyKeys }))
              .count,
            auditLogs: (await tx.auditLog.deleteMany({ where: where.auditLogs })).count,
            documentAccessLogs: (
              await tx.documentAccessLog.deleteMany({ where: where.documentAccessLogs })
            ).count,
            ocrJobs: (await tx.ocrJob.deleteMany({ where: where.ocrJobs })).count,
            notifications: (await tx.notification.deleteMany({ where: where.notifications })).count,
            privacyRequests: (await tx.privacyRequest.deleteMany({ where: where.privacyRequests }))
              .count,
            expiredInvitationsMarked,
            staleOcrJobsFailed,
          };
        },
        { timeout: 120_000 },
      );
      await this.db.$transaction([
        this.db.retentionRun.update({
          where: { id: run.id },
          data: { status: RetentionRunStatus.SUCCEEDED, counts, finishedAt: new Date() },
        }),
        this.db.auditLog.create({
          data: {
            action: options.dryRun ? 'retention.dry_run' : 'retention.run',
            entityType: 'RetentionRun',
            entityId: run.id,
            requestId: options.requestId ?? `job-${run.id}`,
            metadata: counts,
          },
        }),
      ]);
      return { runId: run.id, dryRun: options.dryRun, counts };
    } catch (error) {
      await this.db.retentionRun
        .update({
          where: { id: run.id },
          data: {
            status: RetentionRunStatus.FAILED,
            errorCode: 'RETENTION_FAILED',
            finishedAt: new Date(),
          },
        })
        .catch(() => undefined);
      throw error;
    }
  }
}
