import type { NotificationsService } from '../notifications/notifications.service.js';
import type { FundsRepository } from './funds.repository.js';

const CONTRIBUTION_DUE_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Actualiza vencimientos y genera recordatorios idempotentes para cada integrante. */
export class FundContributionRemindersService {
  constructor(
    private readonly repository: FundsRepository,
    private readonly notifications: NotificationsService,
  ) {}

  async run(now = new Date()): Promise<void> {
    const due = await this.repository.contributionMembersDueBetween(
      now,
      new Date(now.getTime() + CONTRIBUTION_DUE_WINDOW_MS),
    );
    for (const item of due) {
      const userId = item.fundMember.groupMember?.userId;
      if (!userId) continue;
      await this.notifications.notify({
        userIds: [userId],
        type: 'fund.contribution_due',
        title: `Aporte pendiente en ${item.request.fund.name}`,
        body: `Aporta ${formatMoney(item.amountCents, item.request.fund.currency)} antes del ${item.request.dueAt.toLocaleDateString('es-ES')}.`,
        data: {
          groupId: item.request.fund.groupId,
          fundId: item.request.fund.id,
          contributionRequestId: item.request.id,
          contributionRequestMemberId: item.id,
        },
        dedupeKey: `fund.contribution_due:${item.id}`,
      });
    }

    await this.repository.markOverdue(now);
    const overdue = await this.repository.contributionMembersOverdue(now);
    for (const item of overdue) {
      const userId = item.fundMember.groupMember?.userId;
      if (!userId) continue;
      await this.notifications.notify({
        userIds: [userId],
        type: 'fund.contribution_overdue',
        title: `Aporte vencido en ${item.request.fund.name}`,
        body: `El aporte pendiente de ${formatMoney(item.amountCents, item.request.fund.currency)} vencio el ${item.request.dueAt.toLocaleDateString('es-ES')}.`,
        data: {
          groupId: item.request.fund.groupId,
          fundId: item.request.fund.id,
          contributionRequestId: item.request.id,
          contributionRequestMemberId: item.id,
        },
        dedupeKey: `fund.contribution_overdue:${item.id}`,
      });
    }
  }
}

function formatMoney(amountCents: number, currency: string): string {
  return `${(amountCents / 100).toFixed(2)} ${currency}`;
}
