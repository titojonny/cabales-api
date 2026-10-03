import type { Prisma } from '@prisma/client';
import {
  GroupRole,
  InvitationStatus,
  PrivacyRequestStatus,
  type PrivacyRequestType,
} from '@prisma/client';
import type { Database } from '../../database/client.js';

const requestView = {
  id: true,
  type: true,
  status: true,
  reason: true,
  createdAt: true,
  updatedAt: true,
  confirmedAt: true,
  cancelledAt: true,
  completedAt: true,
  exportExpiresAt: true,
  resultSummary: true,
} as const;

export type PrivacyRequestView = Prisma.PrivacyRequestGetPayload<{ select: typeof requestView }>;

const OPEN_STATUSES = [PrivacyRequestStatus.PENDING, PrivacyRequestStatus.IN_PROGRESS];

/** Persistencia de solicitudes de privacidad, exportación y anonimización. */
export class PrivacyRepository {
  constructor(private readonly db: Database) {}

  findOpenOfType(userId: string, type: PrivacyRequestType) {
    return this.db.privacyRequest.findFirst({
      where: { userId, type, status: { in: OPEN_STATUSES } },
      select: { id: true },
    });
  }

  create(userId: string, type: PrivacyRequestType, reason: string | undefined, requestId: string) {
    return this.db.$transaction(async (tx) => {
      const created = await tx.privacyRequest.create({
        data: { userId, type, ...(reason ? { reason } : {}) },
        select: requestView,
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'privacy.requested',
          entityType: 'PrivacyRequest',
          entityId: created.id,
          requestId,
          metadata: { type },
        },
      });
      return created;
    });
  }

  list(userId: string) {
    return this.db.privacyRequest.findMany({
      where: { userId },
      select: requestView,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  get(userId: string, id: string) {
    return this.db.privacyRequest.findFirst({ where: { id, userId }, select: requestView });
  }

  /** Transición condicional y auditada; devuelve null si otra petición cambió el estado antes. */
  transition(input: {
    userId: string;
    id: string;
    from: PrivacyRequestStatus[];
    to: PrivacyRequestStatus;
    requestId: string;
    data?: Prisma.PrivacyRequestUpdateManyMutationInput;
  }) {
    return this.db.$transaction(async (tx) => {
      const changed = await tx.privacyRequest.updateMany({
        where: { id: input.id, userId: input.userId, status: { in: input.from } },
        data: { status: input.to, ...input.data },
      });
      if (changed.count !== 1) return null;
      await tx.auditLog.create({
        data: {
          userId: input.userId,
          action: `privacy.${input.to.toLowerCase()}`,
          entityType: 'PrivacyRequest',
          entityId: input.id,
          requestId: input.requestId,
        },
      });
      return tx.privacyRequest.findUnique({ where: { id: input.id }, select: requestView });
    });
  }

  async logExport(userId: string, id: string, requestId: string) {
    await this.db.auditLog.create({
      data: {
        userId,
        action: 'privacy.export_downloaded',
        entityType: 'PrivacyRequest',
        entityId: id,
        requestId,
      },
    });
  }

  /**
   * Reúne los datos del titular. Excluye secretos, tokens, hashes, sesiones, direcciones IP
   * y datos identificables de terceros (correos, nombres de otros usuarios).
   */
  async exportData(userId: string) {
    const [
      user,
      memberships,
      events,
      documents,
      notifications,
      privacyRequests,
      invitations,
      activity,
      fundMovements,
    ] = await Promise.all([
      this.db.user.findUniqueOrThrow({
        where: { id: userId },
        select: {
          email: true,
          displayName: true,
          avatarUrl: true,
          locale: true,
          emailVerifiedAt: true,
          createdAt: true,
        },
      }),
      this.db.groupMember.findMany({
        where: { userId },
        select: {
          id: true,
          role: true,
          joinedAt: true,
          group: { select: { id: true, name: true, currency: true } },
        },
      }),
      this.db.event.findMany({
        where: { createdById: userId },
        select: {
          id: true,
          groupId: true,
          name: true,
          description: true,
          startsAt: true,
          status: true,
          createdAt: true,
        },
      }),
      this.db.document.findMany({
        where: { ownerId: userId },
        select: {
          id: true,
          groupId: true,
          name: true,
          mimeType: true,
          sizeBytes: true,
          createdAt: true,
        },
      }),
      this.db.notification.findMany({
        where: { userId },
        select: {
          type: true,
          title: true,
          body: true,
          status: true,
          createdAt: true,
          readAt: true,
        },
        take: 1000,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.privacyRequest.findMany({
        where: { userId },
        select: { type: true, status: true, createdAt: true, completedAt: true },
      }),
      this.db.groupInvitation.findMany({
        where: { invitedById: userId },
        select: { groupId: true, role: true, status: true, createdAt: true },
      }),
      this.db.auditLog.findMany({
        where: { userId },
        select: { action: true, entityType: true, createdAt: true },
        take: 5000,
        orderBy: { createdAt: 'desc' },
      }),
      this.db.fundMovement.findMany({
        where: { createdById: userId },
        select: { fundId: true, type: true, amountCents: true, description: true, createdAt: true },
      }),
    ]);
    const memberIds = memberships.map((membership) => membership.id);
    const [shares, payments, transfers] = await Promise.all([
      this.db.expenseParticipant.findMany({
        where: { groupMemberId: { in: memberIds } },
        select: {
          shareCents: true,
          payer: { select: { amountCents: true } },
          expense: {
            select: {
              id: true,
              groupId: true,
              eventId: true,
              title: true,
              notes: true,
              totalCents: true,
              currency: true,
              occurredAt: true,
              createdById: true,
            },
          },
        },
        take: 10_000,
      }),
      this.db.expense.findMany({
        where: { createdById: userId },
        select: {
          id: true,
          groupId: true,
          eventId: true,
          title: true,
          notes: true,
          totalCents: true,
          currency: true,
          occurredAt: true,
        },
        take: 10_000,
      }),
      this.db.settlementTransfer.findMany({
        where: {
          OR: [
            { debtor: { groupMemberId: { in: memberIds } } },
            { creditor: { groupMemberId: { in: memberIds } } },
          ],
        },
        select: {
          id: true,
          settlementId: true,
          amountCents: true,
          status: true,
          paidAt: true,
          createdAt: true,
          debtor: { select: { groupMemberId: true } },
          settlement: { select: { groupId: true, currency: true } },
        },
        take: 10_000,
      }),
    ]);

    const expenses = new Map<string, Record<string, unknown>>();
    for (const expense of payments) {
      expenses.set(expense.id, {
        ...expense,
        expenseId: expense.id,
        id: undefined,
        createdByMe: true,
        myShareCents: 0,
        myPaidCents: 0,
      });
    }
    for (const share of shares) {
      const createdByMe = share.expense.createdById === userId;
      const current = expenses.get(share.expense.id) ?? {
        expenseId: share.expense.id,
        groupId: share.expense.groupId,
        eventId: share.expense.eventId,
        title: share.expense.title,
        // Las notas pertenecen a quien creó el gasto; solo se exportan las propias.
        notes: createdByMe ? share.expense.notes : null,
        totalCents: share.expense.totalCents,
        currency: share.expense.currency,
        occurredAt: share.expense.occurredAt,
        createdByMe,
        myShareCents: 0,
        myPaidCents: 0,
      };
      current['myShareCents'] = share.shareCents;
      current['myPaidCents'] = share.payer?.amountCents ?? 0;
      expenses.set(share.expense.id, current);
    }
    const memberSet = new Set(memberIds);

    return {
      format: 'cabales-export-v1',
      generatedAt: new Date().toISOString(),
      profile: user,
      groups: memberships.map((membership) => ({
        groupId: membership.group.id,
        name: membership.group.name,
        currency: membership.group.currency,
        role: membership.role,
        joinedAt: membership.joinedAt,
      })),
      eventsCreated: events,
      expenses: [...expenses.values()].map(({ id: _id, ...rest }) => rest),
      settlementTransfers: transfers.map((transfer) => ({
        transferId: transfer.id,
        settlementId: transfer.settlementId,
        groupId: transfer.settlement.groupId,
        currency: transfer.settlement.currency,
        direction:
          transfer.debtor.groupMemberId && memberSet.has(transfer.debtor.groupMemberId)
            ? 'OWED_BY_ME'
            : 'OWED_TO_ME',
        amountCents: transfer.amountCents,
        status: transfer.status,
        paidAt: transfer.paidAt,
        createdAt: transfer.createdAt,
      })),
      fundMovements,
      documents,
      notifications,
      privacyRequests,
      invitationsSent: invitations,
      activity,
    };
  }

  /**
   * Supresión: anonimiza la identidad, elimina credenciales y datos personales no financieros,
   * transfiere la propiedad de grupos compartidos y conserva el historial financiero anonimizado.
   * Devuelve claves de almacenamiento a borrar tras confirmar la transacción.
   */
  async eraseUser(userId: string, privacyRequestId: string, requestId: string) {
    return this.db.$transaction(
      async (tx) => {
        const now = new Date();
        const user = await tx.user.findUniqueOrThrow({
          where: { id: userId },
          select: { email: true },
        });
        const ownerships = await tx.groupMember.findMany({
          where: { userId, role: GroupRole.OWNER },
          select: { groupId: true },
        });
        let transferredGroups = 0;
        let deletedGroups = 0;
        for (const { groupId } of ownerships) {
          const otherOwner = await tx.groupMember.findFirst({
            where: { groupId, role: GroupRole.OWNER, userId: { not: userId } },
            select: { id: true },
          });
          if (otherOwner) continue;
          const successor =
            (await tx.groupMember.findFirst({
              where: { groupId, role: GroupRole.ADMIN, userId: { not: userId } },
              orderBy: { joinedAt: 'asc' },
              select: { id: true },
            })) ??
            (await tx.groupMember.findFirst({
              where: { groupId, userId: { not: userId } },
              orderBy: { joinedAt: 'asc' },
              select: { id: true },
            }));
          if (successor) {
            await tx.groupMember.update({
              where: { id: successor.id },
              data: { role: GroupRole.OWNER },
            });
            transferredGroups += 1;
            continue;
          }
          const [invitations, events, expenses, settlements, funds, budgets, recurring, documents] =
            await Promise.all([
              tx.groupInvitation.count({ where: { groupId } }),
              tx.event.count({ where: { groupId } }),
              tx.expense.count({ where: { groupId } }),
              tx.settlement.count({ where: { groupId } }),
              tx.fund.count({ where: { groupId } }),
              tx.budget.count({ where: { groupId } }),
              tx.recurringExpense.count({ where: { groupId } }),
              tx.document.count({ where: { groupId } }),
            ]);
          // No se borra un grupo que aún contiene datos de otros módulos o documentos compartidos.
          const activity = invitations + events + expenses + settlements + funds + budgets + recurring + documents;
          if (activity === 0) {
            await tx.group.delete({ where: { id: groupId } });
            deletedGroups += 1;
          }
        }

        const documents = await tx.document.findMany({
          where: { ownerId: userId },
          select: { storageKey: true },
        });
        const deleted = {
          accounts: (await tx.account.deleteMany({ where: { userId } })).count,
          sessions: (await tx.session.deleteMany({ where: { userId } })).count,
          verificationTokens: (await tx.emailVerificationToken.deleteMany({ where: { userId } }))
            .count,
          resetTokens: (await tx.passwordResetToken.deleteMany({ where: { userId } })).count,
          pushSubscriptions: (await tx.pushSubscription.deleteMany({ where: { userId } })).count,
          notifications: (await tx.notification.deleteMany({ where: { userId } })).count,
          notificationPreferences: (
            await tx.notificationPreference.deleteMany({ where: { userId } })
          ).count,
          idempotencyKeys: (await tx.idempotencyKey.deleteMany({ where: { userId } })).count,
          documentGrants: (await tx.documentAccessGrant.deleteMany({ where: { userId } })).count,
          documents: (await tx.document.deleteMany({ where: { ownerId: userId } })).count,
          achievements: (await tx.userAchievement.deleteMany({ where: { userId } })).count,
        };
        const revokedInvitations = (
          await tx.groupInvitation.updateMany({
            where: {
              status: InvitationStatus.PENDING,
              OR: [{ invitedById: userId }, { email: user.email }],
            },
            data: { status: InvitationStatus.REVOKED, revokedAt: now },
          })
        ).count;
        await tx.privacyRequest.updateMany({
          where: { userId, id: { not: privacyRequestId }, status: { in: OPEN_STATUSES } },
          data: { status: PrivacyRequestStatus.CANCELLED, cancelledAt: now },
        });
        await tx.user.update({
          where: { id: userId },
          data: {
            email: `deleted+${userId}@anon.cabales.invalid`,
            displayName: 'Usuario eliminado',
            avatarUrl: null,
            emailVerifiedAt: null,
            isActive: false,
            deletedAt: now,
          },
        });
        const summary = { ...deleted, revokedInvitations, transferredGroups, deletedGroups };
        await tx.privacyRequest.update({
          where: { id: privacyRequestId },
          data: {
            status: PrivacyRequestStatus.COMPLETED,
            confirmedAt: now,
            completedAt: now,
            resultSummary: summary,
          },
        });
        await tx.auditLog.create({
          data: {
            userId,
            action: 'privacy.erasure_completed',
            entityType: 'User',
            entityId: userId,
            requestId,
            metadata: summary,
          },
        });
        return { storageKeys: documents.map((document) => document.storageKey), summary };
      },
      { timeout: 30_000 },
    );
  }
}
