import { TransferStatus, InvitationStatus } from '@prisma/client';
import type { Database } from '../../database/client.js';
import type { DomainEvent } from '../../shared/events.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

type Metric =
  | 'groupsCreated'
  | 'eventsCreated'
  | 'expensesCreated'
  | 'settlementsCreated'
  | 'transfersPaid'
  | 'invitesAccepted';

/** Catálogo versionado en código; se sincroniza de forma idempotente con la tabla Achievement. */
export const ACHIEVEMENTS: ReadonlyArray<{
  code: string;
  name: string;
  description: string;
  category: 'EVENTOS' | 'GASTOS' | 'CIERRES' | 'PAGOS' | 'COORDINACION';
  metric: Metric;
  target: number;
}> = [
  {
    code: 'FIRST_GROUP',
    name: 'Primer grupo',
    description: 'Crea tu primer grupo.',
    category: 'COORDINACION',
    metric: 'groupsCreated',
    target: 1,
  },
  {
    code: 'FIRST_EVENT',
    name: 'Plan en marcha',
    description: 'Crea tu primer evento.',
    category: 'EVENTOS',
    metric: 'eventsCreated',
    target: 1,
  },
  {
    code: 'EVENT_PLANNER',
    name: 'Organizador',
    description: 'Crea 5 eventos.',
    category: 'EVENTOS',
    metric: 'eventsCreated',
    target: 5,
  },
  {
    code: 'FIRST_EXPENSE',
    name: 'Cuentas claras',
    description: 'Registra tu primer gasto.',
    category: 'GASTOS',
    metric: 'expensesCreated',
    target: 1,
  },
  {
    code: 'EXPENSE_TRACKER',
    name: 'Registro al día',
    description: 'Registra 25 gastos.',
    category: 'GASTOS',
    metric: 'expensesCreated',
    target: 25,
  },
  {
    code: 'FIRST_CLOSE',
    name: 'Primer cierre',
    description: 'Liquida tu primer evento.',
    category: 'CIERRES',
    metric: 'settlementsCreated',
    target: 1,
  },
  {
    code: 'CLOSER',
    name: 'Cierra ciclos',
    description: 'Liquida 5 eventos.',
    category: 'CIERRES',
    metric: 'settlementsCreated',
    target: 5,
  },
  {
    code: 'GOOD_PAYER',
    name: 'Buen pagador',
    description: 'Paga tu primera deuda liquidada.',
    category: 'PAGOS',
    metric: 'transfersPaid',
    target: 1,
  },
  {
    code: 'RELIABLE_PAYER',
    name: 'Palabra cumplida',
    description: 'Paga 10 deudas liquidadas.',
    category: 'PAGOS',
    metric: 'transfersPaid',
    target: 10,
  },
  {
    code: 'CONNECTOR',
    name: 'Conector',
    description: 'Consigue que 3 personas acepten tus invitaciones.',
    category: 'COORDINACION',
    metric: 'invitesAccepted',
    target: 3,
  },
];

/** Logros basados en datos reales: progreso derivado y desbloqueo idempotente. */
export class AchievementsService {
  constructor(
    private readonly db: Database,
    private readonly notifications?: NotificationsService,
  ) {}

  private async metrics(userId: string): Promise<Record<Metric, number>> {
    const memberIds = (
      await this.db.groupMember.findMany({ where: { userId }, select: { id: true } })
    ).map((m) => m.id);
    const [
      groupsCreated,
      eventsCreated,
      expensesCreated,
      settlementsCreated,
      transfersPaid,
      invitesAccepted,
    ] = await Promise.all([
      this.db.group.count({ where: { createdById: userId } }),
      this.db.event.count({ where: { createdById: userId } }),
      this.db.expense.count({ where: { createdById: userId } }),
      this.db.settlement.count({ where: { createdById: userId } }),
      this.db.settlementTransfer.count({
        where: { status: TransferStatus.PAID, debtor: { groupMemberId: { in: memberIds } } },
      }),
      this.db.groupInvitation.count({
        where: { invitedById: userId, status: InvitationStatus.ACCEPTED },
      }),
    ]);
    return {
      groupsCreated,
      eventsCreated,
      expensesCreated,
      settlementsCreated,
      transfersPaid,
      invitesAccepted,
    };
  }

  private async syncCatalog() {
    await this.db.achievement.createMany({
      data: ACHIEVEMENTS.map(({ code, name, description }) => ({ code, name, description })),
      skipDuplicates: true,
    });
    return new Map(
      (await this.db.achievement.findMany({ select: { id: true, code: true } })).map((row) => [
        row.code,
        row.id,
      ]),
    );
  }

  /** Evalúa y desbloquea; repetir la evaluación nunca duplica logros ni avisos. */
  async evaluate(userId: string) {
    const [metrics, ids] = await Promise.all([this.metrics(userId), this.syncCatalog()]);
    const awarded = await this.db.userAchievement.findMany({
      where: { userId },
      select: { awardedAt: true, achievement: { select: { code: true } } },
    });
    const awardedMap = new Map(awarded.map((row) => [row.achievement.code, row.awardedAt]));
    const newlyUnlocked = ACHIEVEMENTS.filter(
      (achievement) =>
        metrics[achievement.metric] >= achievement.target && !awardedMap.has(achievement.code),
    );
    if (newlyUnlocked.length > 0) {
      const result = await this.db.userAchievement.createMany({
        data: newlyUnlocked.map((achievement) => ({
          userId,
          achievementId: ids.get(achievement.code)!,
        })),
        skipDuplicates: true,
      });
      const now = new Date();
      newlyUnlocked.forEach((achievement) => awardedMap.set(achievement.code, now));
      if (result.count > 0 && this.notifications) {
        for (const achievement of newlyUnlocked) {
          await this.notifications.notify({
            userIds: [userId],
            type: 'achievement.unlocked',
            title: `Logro conseguido: ${achievement.name}`,
            body: achievement.description,
            data: { code: achievement.code },
            dedupeKey: `achievement:${achievement.code}`,
          });
        }
      }
    }
    return ACHIEVEMENTS.map((achievement) => {
      const progress = Math.min(metrics[achievement.metric], achievement.target);
      const awardedAt = awardedMap.get(achievement.code) ?? null;
      return {
        code: achievement.code,
        name: achievement.name,
        description: achievement.description,
        category: achievement.category,
        target: achievement.target,
        progress,
        status: awardedAt ? 'UNLOCKED' : progress > 0 ? 'IN_PROGRESS' : 'LOCKED',
        awardedAt,
      };
    });
  }

  async history(userId: string) {
    const rows = await this.db.userAchievement.findMany({
      where: { userId },
      select: {
        awardedAt: true,
        achievement: { select: { code: true, name: true, description: true } },
      },
      orderBy: { awardedAt: 'desc' },
    });
    return rows.map((row) => ({ ...row.achievement, awardedAt: row.awardedAt }));
  }

  /** Reevalúa a las personas afectadas por un hecho de dominio. */
  async handle(event: DomainEvent): Promise<void> {
    switch (event.type) {
      case 'group.created':
      case 'event.created':
      case 'expense.created':
      case 'settlement.created':
        await this.evaluate(event.userId);
        return;
      case 'invitation.accepted':
        await this.evaluate(event.inviterId);
        return;
      case 'transfer.paid': {
        const transfer = await this.db.settlementTransfer.findUnique({
          where: { id: event.transferId },
          select: { debtor: { select: { groupMember: { select: { userId: true } } } } },
        });
        const debtor = transfer?.debtor.groupMember?.userId;
        if (debtor) await this.evaluate(debtor);
        return;
      }
      default:
        return;
    }
  }
}
