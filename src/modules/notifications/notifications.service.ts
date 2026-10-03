import { GroupRole, NotificationStatus, Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { ensure } from '../../shared/errors.js';
import type { DomainEvent } from '../../shared/events.js';
import { emailTemplates, type EmailProvider } from '../../infrastructure/email.js';
import { PushProviderError, type NotificationPushProvider } from '../../infrastructure/push.js';
import type { BudgetsService } from '../budgets/budgets.service.js';
import {
  NOTIFICATION_TYPES,
  type ListNotificationsQuery,
  type NotificationType,
  type PushSubscriptionInput,
  type UpdatePreferencesInput,
} from './notifications.schema.js';

const notificationView = {
  id: true,
  type: true,
  title: true,
  body: true,
  data: true,
  status: true,
  createdAt: true,
  readAt: true,
  archivedAt: true,
} as const;

/** Preferencias por defecto: todo dentro de la app; correo solo para avisos de alto valor. */
const DEFAULTS: Record<NotificationType, { inApp: boolean; email: boolean; push: boolean }> = {
  'invitation.received': { inApp: true, email: false, push: false },
  'invitation.accepted': { inApp: true, email: false, push: false },
  'settlement.created': { inApp: true, email: true, push: false },
  'transfer.paid': { inApp: true, email: false, push: false },
  'budget.threshold': { inApp: true, email: true, push: false },
  'fund.movement': { inApp: true, email: false, push: false },
  'ocr.finished': { inApp: true, email: false, push: false },
  'privacy.updated': { inApp: true, email: true, push: false },
  'achievement.unlocked': { inApp: true, email: false, push: false },
  'event.reminder': { inApp: true, email: false, push: false },
};

export interface NotifyInput {
  userIds: string[];
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string | number | boolean | null>;
  dedupeKey?: string;
}

/** Centro de avisos: persistencia, preferencias, correo y push con degradación elegante. */
export class NotificationsService {
  constructor(
    private readonly db: Database,
    private readonly options: {
      email?: EmailProvider;
      push?: NotificationPushProvider;
      appOrigin: string;
      budgets?: BudgetsService;
    },
  ) {}

  private async preferences(userId: string) {
    const rows = await this.db.notificationPreference.findMany({ where: { userId } });
    const map = new Map(rows.map((row) => [row.type, row]));
    return NOTIFICATION_TYPES.map((type) => {
      const row = map.get(type);
      return {
        type,
        ...(row ? { inApp: row.inApp, email: row.email, push: row.push } : DEFAULTS[type]),
      };
    });
  }

  /** Emite avisos idempotentes (dedupeKey) respetando preferencias; nunca lanza por canales externos. */
  async notify(input: NotifyInput): Promise<number> {
    let created = 0;
    for (const userId of [...new Set(input.userIds)]) {
      const user = await this.db.user.findUnique({
        where: { id: userId },
        select: { email: true, isActive: true, emailVerifiedAt: true },
      });
      if (!user?.isActive) continue;
      const preference = (await this.preferences(userId)).find((item) => item.type === input.type)!;
      // Con dedupeKey se persiste también un marcador archivado cuando la persona
      // desactivó in-app; así correo y push no se repiten en cada tick del planificador.
      const shouldPersistDedupe = Boolean(input.dedupeKey);
      if (preference.inApp || shouldPersistDedupe) {
        try {
          await this.db.notification.create({
            data: {
              userId,
              type: input.type,
              title: input.title.slice(0, 160),
              body: input.body.slice(0, 1000),
              ...(preference.inApp
                ? {}
                : { status: NotificationStatus.ARCHIVED, archivedAt: new Date() }),
              ...(input.data ? { data: input.data } : {}),
              ...(input.dedupeKey ? { dedupeKey: input.dedupeKey } : {}),
            },
          });
          if (preference.inApp) created += 1;
        } catch (error) {
          if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
            continue;
          throw error;
        }
      }
      if (preference.email && user.emailVerifiedAt && this.options.email) {
        await this.options.email
          .send({
            to: user.email,
            ...emailTemplates.notification(this.options.appOrigin, input.title, input.body),
          })
          .catch(() => undefined);
      }
      if (preference.push && this.options.push?.enabled) {
        const subscriptions = await this.db.pushSubscription.findMany({ where: { userId } });
        for (const subscription of subscriptions) {
          await this.options.push
            .send(subscription, { title: input.title, body: input.body, url: '/app/notifications' })
            .catch(async (error: unknown) => {
              if (
                error instanceof PushProviderError &&
                (error.statusCode === 404 || error.statusCode === 410)
              ) {
                await this.db.pushSubscription.deleteMany({
                  where: { userId, endpoint: subscription.endpoint },
                });
              }
              return false;
            });
        }
      }
    }
    return created;
  }

  async list(userId: string, query: ListNotificationsQuery) {
    const status =
      query.status === 'ACTIVE'
        ? { in: [NotificationStatus.UNREAD, NotificationStatus.READ] }
        : (query.status as NotificationStatus);
    const rows = await this.db.notification.findMany({
      where: { userId, status },
      select: notificationView,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    const items = rows.slice(0, query.limit);
    return { items, nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null };
  }

  async unreadCount(userId: string) {
    return {
      unread: await this.db.notification.count({
        where: { userId, status: NotificationStatus.UNREAD },
      }),
    };
  }

  async markRead(userId: string, id: string) {
    const updated = await this.db.notification.updateMany({
      where: { id, userId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    if (updated.count === 0)
      ensure(await this.exists(userId, id), 404, 'NOTIFICATION_NOT_FOUND', 'Aviso no encontrado');
    return this.db.notification.findUniqueOrThrow({ where: { id }, select: notificationView });
  }

  async archive(userId: string, id: string) {
    ensure(await this.exists(userId, id), 404, 'NOTIFICATION_NOT_FOUND', 'Aviso no encontrado');
    const now = new Date();
    await this.db.notification.updateMany({
      where: { id, userId, status: { not: NotificationStatus.ARCHIVED } },
      data: { status: NotificationStatus.ARCHIVED, archivedAt: now },
    });
    await this.db.notification.updateMany({
      where: { id, userId, readAt: null },
      data: { readAt: now },
    });
    return this.db.notification.findUniqueOrThrow({ where: { id }, select: notificationView });
  }

  async markAllRead(userId: string) {
    const updated = await this.db.notification.updateMany({
      where: { userId, status: NotificationStatus.UNREAD },
      data: { status: NotificationStatus.READ, readAt: new Date() },
    });
    return { updated: updated.count };
  }

  async getPreferences(userId: string) {
    return {
      preferences: await this.preferences(userId),
      channels: {
        inApp: true,
        email: Boolean(this.options.email && this.options.email.name !== 'logging'),
        push: Boolean(this.options.push?.enabled),
      },
    };
  }

  getPushConfig() {
    return {
      enabled: Boolean(this.options.push?.enabled),
      publicKey: this.options.push?.publicKey ?? null,
    };
  }

  async updatePreferences(userId: string, input: UpdatePreferencesInput) {
    await this.db.$transaction(
      input.preferences.map((preference) =>
        this.db.notificationPreference.upsert({
          where: { userId_type: { userId, type: preference.type } },
          create: { userId, ...preference },
          update: { inApp: preference.inApp, email: preference.email, push: preference.push },
        }),
      ),
    );
    return this.getPreferences(userId);
  }

  async subscribePush(userId: string, input: PushSubscriptionInput) {
    const existing = await this.db.pushSubscription.findUnique({
      where: { endpoint: input.endpoint },
      select: { userId: true },
    });
    ensure(
      !existing || existing.userId === userId,
      409,
      'PUSH_SUBSCRIPTION_OWNED',
      'La suscripcion push ya pertenece a otra cuenta',
    );
    await this.db.pushSubscription.upsert({
      where: { endpoint: input.endpoint },
      create: {
        userId,
        endpoint: input.endpoint,
        p256dh: input.keys.p256dh,
        auth: input.keys.auth,
      },
      update: { p256dh: input.keys.p256dh, auth: input.keys.auth },
    });
    return { subscribed: true, pushEnabled: Boolean(this.options.push?.enabled) };
  }

  async unsubscribePush(userId: string, endpoint: string) {
    const removed = await this.db.pushSubscription.deleteMany({ where: { userId, endpoint } });
    return { removed: removed.count };
  }

  private async exists(userId: string, id: string) {
    return this.db.notification.findFirst({ where: { id, userId }, select: { id: true } });
  }

  private async registeredUsersOfEvent(eventId: string) {
    const participants = await this.db.eventParticipant.findMany({
      where: { eventId, groupMemberId: { not: null } },
      select: { groupMember: { select: { userId: true } } },
    });
    return participants.flatMap((participant) =>
      participant.groupMember ? [participant.groupMember.userId] : [],
    );
  }

  /** Traduce hechos de dominio en avisos; sin tokens ni datos sensibles en el contenido. */
  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'invitation.created': {
        const [invitee, group] = await Promise.all([
          this.db.user.findUnique({ where: { email: event.email }, select: { id: true } }),
          this.db.group.findUnique({ where: { id: event.groupId }, select: { name: true } }),
        ]);
        if (!invitee || !group) return;
        await this.notify({
          userIds: [invitee.id],
          type: 'invitation.received',
          title: `Te invitaron a ${group.name}`,
          body: 'Abre el enlace que llegó a tu correo o pide el enlace a quien te invitó para unirte.',
          data: { groupId: event.groupId },
          dedupeKey: `invitation:${event.invitationId}`,
        });
        return;
      }
      case 'invitation.accepted': {
        const [user, group] = await Promise.all([
          this.db.user.findUnique({ where: { id: event.userId }, select: { displayName: true } }),
          this.db.group.findUnique({ where: { id: event.groupId }, select: { name: true } }),
        ]);
        if (!user || !group) return;
        await this.notify({
          userIds: [event.inviterId],
          type: 'invitation.accepted',
          title: `${user.displayName} se unió a ${group.name}`,
          body: 'Ya puede participar en eventos y gastos del grupo.',
          data: { groupId: event.groupId },
          dedupeKey: `invitation-accepted:${event.invitationId}`,
        });
        return;
      }
      case 'settlement.created': {
        const [event_, userIds] = await Promise.all([
          this.db.event.findUnique({ where: { id: event.eventId }, select: { name: true } }),
          this.registeredUsersOfEvent(event.eventId),
        ]);
        await this.notify({
          userIds: userIds.filter((id) => id !== event.userId),
          type: 'settlement.created',
          title: `Se liquidó ${event_?.name ?? 'un evento'}`,
          body: 'Revisa qué te toca pagar o recibir en Cabudas.',
          data: { groupId: event.groupId, settlementId: event.settlementId },
          dedupeKey: `settlement:${event.settlementId}`,
        });
        return;
      }
      case 'transfer.paid': {
        const transfer = await this.db.settlementTransfer.findUnique({
          where: { id: event.transferId },
          select: {
            amountCents: true,
            settlement: { select: { currency: true } },
            debtor: { select: { groupMember: { select: { userId: true } } } },
            creditor: { select: { groupMember: { select: { userId: true } } } },
          },
        });
        if (!transfer) return;
        const recipients = [
          transfer.creditor.groupMember?.userId,
          transfer.debtor.groupMember?.userId,
        ].filter((id): id is string => Boolean(id) && id !== event.userId);
        const amount = (transfer.amountCents / 100).toFixed(2);
        await this.notify({
          userIds: recipients,
          type: 'transfer.paid',
          title: 'Pago registrado',
          body: `Se marcó como pagada una transferencia de ${amount} ${transfer.settlement.currency}.`,
          data: { groupId: event.groupId, settlementId: event.settlementId },
          dedupeKey: `transfer-paid:${event.transferId}`,
        });
        return;
      }
      case 'expense.created': {
        if (!this.options.budgets) return;
        const affected = await this.options.budgets.affectedBy(event.expenseId);
        if (affected.length === 0) return;
        const managers = await this.db.groupMember.findMany({
          where: { groupId: event.groupId, role: { in: [GroupRole.OWNER, GroupRole.ADMIN] } },
          select: { userId: true },
        });
        for (const { budget, progress } of affected) {
          if (progress.alert === 'OK') continue;
          await this.notify({
            userIds: managers.map((manager) => manager.userId),
            type: 'budget.threshold',
            title:
              progress.alert === 'EXCEEDED'
                ? `Presupuesto excedido: ${budget.name}`
                : `Presupuesto al ${Math.floor(progress.progressPercent)}%: ${budget.name}`,
            body: `Consumo del periodo: ${(progress.spentCents / 100).toFixed(2)} de ${(budget.amountCents / 100).toFixed(2)} ${budget.currency}.`,
            data: { groupId: event.groupId, budgetId: budget.id },
            dedupeKey: `budget:${budget.id}:${progress.periodStart.toISOString()}:${progress.alert}`,
          });
        }
        return;
      }
      case 'fund.movement': {
        const [managers, fund] = await Promise.all([
          this.db.fundMember.findMany({
            where: { fundId: event.fundId, role: 'MANAGER' },
            select: { groupMember: { select: { userId: true } } },
          }),
          this.db.fund.findUnique({ where: { id: event.fundId }, select: { name: true } }),
        ]);
        await this.notify({
          userIds: managers
            .map((manager) => manager.groupMember.userId)
            .filter((id) => id !== event.userId),
          type: 'fund.movement',
          title: `Nuevo movimiento en ${fund?.name ?? 'un fondo'}`,
          body: 'Revisa el historial del fondo para ver el detalle.',
          data: { groupId: event.groupId, fundId: event.fundId },
          dedupeKey: `fund-movement:${event.movementId}`,
        });
        return;
      }
      case 'ocr.finished':
        await this.notify({
          userIds: [event.userId],
          type: 'ocr.finished',
          title:
            event.status === 'SUCCEEDED' ? 'Comprobante leído' : 'No pudimos leer el comprobante',
          body:
            event.status === 'SUCCEEDED'
              ? 'Revisa y confirma los datos detectados antes de guardar el gasto.'
              : 'Puedes reintentar o capturar el gasto manualmente.',
          data: { ocrJobId: event.jobId },
        });
        return;
      case 'privacy.updated':
        await this.notify({
          userIds: [event.userId],
          type: 'privacy.updated',
          title: 'Tu solicitud de privacidad cambió',
          body:
            event.status === 'COMPLETED'
              ? 'La solicitud se completó. Si pediste tus datos, ya puedes descargarlos.'
              : 'La solicitud está en revisión por el responsable de datos.',
          data: { privacyRequestId: event.privacyRequestId },
          dedupeKey: `privacy:${event.privacyRequestId}:${event.status}`,
        });
        return;
      default:
        return;
    }
  }
}
