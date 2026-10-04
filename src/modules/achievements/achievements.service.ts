import { InvitationStatus, TransferStatus } from '@prisma/client';
import type { Database } from '../../database/client.js';
import type { DomainEvent } from '../../shared/events.js';
import type { NotificationsService } from '../notifications/notifications.service.js';

export type AchievementLevel = 'BRONZE' | 'SILVER' | 'GOLD';

type Metric =
  | 'groupsCreated'
  | 'eventsCreated'
  | 'expensesCreated'
  | 'settlementsCreated'
  | 'transfersPaid'
  | 'invitesAccepted'
  | 'onTimePayments'
  | 'punctualPayments'
  | 'fundContributions'
  | 'organizedClosedEvents'
  | 'exemplaryParticipation'
  | 'funEvents';

export interface AchievementDefinition {
  code: string;
  name: string;
  description: string;
  category: 'EVENTOS' | 'GASTOS' | 'CIERRES' | 'PAGOS' | 'COORDINACION' | 'CABUDAS';
  metric: Metric;
  thresholds: Record<AchievementLevel, number>;
}

/** Umbrales objetivos versionados; los puntos son BRONCE=1, PLATA=2 y ORO=3. */
export const ACHIEVEMENTS: ReadonlyArray<AchievementDefinition> = [
  {
    code: 'FIRST_GROUP',
    name: 'Primer grupo',
    description: 'Crea tu primer grupo.',
    category: 'COORDINACION',
    metric: 'groupsCreated',
    thresholds: { BRONZE: 1, SILVER: 3, GOLD: 5 },
  },
  {
    code: 'FIRST_EVENT',
    name: 'Plan en marcha',
    description: 'Crea tu primer evento.',
    category: 'EVENTOS',
    metric: 'eventsCreated',
    thresholds: { BRONZE: 1, SILVER: 5, GOLD: 10 },
  },
  {
    code: 'EVENT_PLANNER',
    name: 'Organizador',
    description: 'Crea eventos para el grupo.',
    category: 'EVENTOS',
    metric: 'eventsCreated',
    thresholds: { BRONZE: 5, SILVER: 10, GOLD: 25 },
  },
  {
    code: 'FIRST_EXPENSE',
    name: 'Cuentas claras',
    description: 'Registra tu primer gasto.',
    category: 'GASTOS',
    metric: 'expensesCreated',
    thresholds: { BRONZE: 1, SILVER: 10, GOLD: 25 },
  },
  {
    code: 'EXPENSE_TRACKER',
    name: 'Registro al dia',
    description: 'Registra gastos compartidos.',
    category: 'GASTOS',
    metric: 'expensesCreated',
    thresholds: { BRONZE: 25, SILVER: 50, GOLD: 100 },
  },
  {
    code: 'FIRST_CLOSE',
    name: 'Primer cierre',
    description: 'Liquida tu primer evento.',
    category: 'CIERRES',
    metric: 'settlementsCreated',
    thresholds: { BRONZE: 1, SILVER: 3, GOLD: 10 },
  },
  {
    code: 'CLOSER',
    name: 'Cierra ciclos',
    description: 'Liquida eventos completos.',
    category: 'CIERRES',
    metric: 'settlementsCreated',
    thresholds: { BRONZE: 5, SILVER: 10, GOLD: 25 },
  },
  {
    code: 'GOOD_PAYER',
    name: 'Buen pagador',
    description: 'Paga tu primera deuda liquidada.',
    category: 'PAGOS',
    metric: 'transfersPaid',
    thresholds: { BRONZE: 1, SILVER: 5, GOLD: 10 },
  },
  {
    code: 'RELIABLE_PAYER',
    name: 'Palabra cumplida',
    description: 'Paga deudas liquidadas.',
    category: 'PAGOS',
    metric: 'transfersPaid',
    thresholds: { BRONZE: 10, SILVER: 25, GOLD: 50 },
  },
  {
    code: 'CONNECTOR',
    name: 'Conector',
    description: 'Consigue que personas acepten tus invitaciones.',
    category: 'COORDINACION',
    metric: 'invitesAccepted',
    thresholds: { BRONZE: 3, SILVER: 10, GOLD: 25 },
  },
  {
    code: 'ALWAYS_PAYS',
    name: 'Siempre paga',
    description: 'Paga transferencias antes o en la fecha limite.',
    category: 'PAGOS',
    metric: 'onTimePayments',
    thresholds: { BRONZE: 1, SILVER: 5, GOLD: 15 },
  },
  {
    code: 'MOST_PUNCTUAL',
    name: 'El mas puntual',
    description: 'Paga antes de la fecha limite o mas rapido que la mediana del grupo.',
    category: 'PAGOS',
    metric: 'punctualPayments',
    thresholds: { BRONZE: 1, SILVER: 5, GOLD: 15 },
  },
  {
    code: 'FUND_KING',
    name: 'Rey de las cabudas',
    description: 'Registra aportes en fondos compartidos.',
    category: 'CABUDAS',
    metric: 'fundContributions',
    thresholds: { BRONZE: 1, SILVER: 5, GOLD: 15 },
  },
  {
    code: 'PRO_ORGANIZER',
    name: 'Organizador profesional',
    description: 'Organiza eventos que llegan a un cierre.',
    category: 'EVENTOS',
    metric: 'organizedClosedEvents',
    thresholds: { BRONZE: 1, SILVER: 3, GOLD: 10 },
  },
  {
    code: 'EXEMPLARY_COMPANION',
    name: 'Companero ejemplar',
    description: 'Participa y paga sus transferencias sin retrasos.',
    category: 'COORDINACION',
    metric: 'exemplaryParticipation',
    thresholds: { BRONZE: 1, SILVER: 5, GOLD: 15 },
  },
  {
    code: 'JUST_FOR_FUN',
    name: 'Solo por diversion',
    description: 'Asiste a eventos sin gastos compartidos.',
    category: 'EVENTOS',
    metric: 'funEvents',
    thresholds: { BRONZE: 1, SILVER: 3, GOLD: 10 },
  },
];

const LEVELS: readonly AchievementLevel[] = ['BRONZE', 'SILVER', 'GOLD'];
const LEVEL_POINTS: Record<AchievementLevel, number> = { BRONZE: 1, SILVER: 2, GOLD: 3 };
const METRICS_CACHE_TTL_MS = 60_000;
type Metrics = Record<Metric, number>;

/** Logros derivados de consultas agregadas; no fabrica progreso ni miembros de grupos. */
export class AchievementsService {
  private readonly metricsCache = new Map<
    string,
    { expiresAt: number; value: Promise<Metrics> }
  >();

  constructor(
    private readonly db: Database,
    private readonly notifications?: NotificationsService,
  ) {}

  private metrics(userId: string): Promise<Metrics> {
    const cached = this.metricsCache.get(userId);
    if (cached && cached.expiresAt > Date.now()) return cached.value;
    const value = this.computeMetrics(userId);
    this.metricsCache.set(userId, { expiresAt: Date.now() + METRICS_CACHE_TTL_MS, value });
    void value.catch(() => {
      if (this.metricsCache.get(userId)?.value === value) this.metricsCache.delete(userId);
    });
    return value;
  }

  private async computeMetrics(userId: string): Promise<Metrics> {
    const groupMembers = await this.db.groupMember.findMany({
      where: { userId },
      select: { id: true, groupId: true },
    });
    const memberIds = groupMembers.map((member) => member.id);
    const groupIds = [...new Set(groupMembers.map((member) => member.groupId))];
    const [paidTransfers, groupPaidTransfers] = await Promise.all([
      this.db.settlementTransfer.findMany({
        where: { status: TransferStatus.PAID, debtor: { groupMemberId: { in: memberIds } } },
        select: {
          paidAt: true,
          dueAt: true,
          settlement: { select: { groupId: true, createdAt: true } },
        },
      }),
      this.db.settlementTransfer.findMany({
        where: {
          status: TransferStatus.PAID,
          settlement: { groupId: { in: groupIds } },
        },
        select: {
          paidAt: true,
          settlement: { select: { groupId: true, createdAt: true } },
        },
      }),
    ]);
    const medianByGroup = new Map<string, number>();
    for (const groupId of groupIds) {
      const durations = groupPaidTransfers
        .filter((transfer) => transfer.settlement.groupId === groupId && transfer.paidAt)
        .map((transfer) => transfer.paidAt!.getTime() - transfer.settlement.createdAt.getTime())
        .sort((a, b) => a - b);
      if (durations.length > 0) medianByGroup.set(groupId, median(durations));
    }
    const onTimePayments = paidTransfers.filter(
      (transfer) => transfer.dueAt && transfer.paidAt && transfer.paidAt <= transfer.dueAt,
    ).length;
    const punctualPayments = paidTransfers.filter((transfer) => {
      if (!transfer.paidAt) return false;
      const onTime = Boolean(transfer.dueAt && transfer.paidAt <= transfer.dueAt);
      const groupMedian = medianByGroup.get(transfer.settlement.groupId);
      return (
        onTime ||
        (groupMedian !== undefined &&
          transfer.paidAt.getTime() - transfer.settlement.createdAt.getTime() < groupMedian)
      );
    }).length;
    const [
      groupsCreated,
      eventsCreated,
      expensesCreated,
      settlementsCreated,
      transfersPaid,
      invitesAccepted,
      fundContributions,
      organizedClosedEvents,
      participationCount,
      funEvents,
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
      this.db.fundMovement.count({ where: { type: 'CONTRIBUTION', createdById: userId } }),
      this.db.event.count({ where: { createdById: userId, status: 'CLOSED' } }),
      this.db.eventParticipant.count({
        where: {
          groupMemberId: { in: memberIds },
          rsvpStatus: { in: ['GOING', 'MAYBE'] },
          event: { status: 'CLOSED' },
        },
      }),
      this.db.eventParticipant.count({
        where: {
          groupMemberId: { in: memberIds },
          rsvpStatus: 'GOING',
          event: { status: { not: 'CANCELLED' }, expenses: { none: {} } },
        },
      }),
    ]);
    return {
      groupsCreated,
      eventsCreated,
      expensesCreated,
      settlementsCreated,
      transfersPaid,
      invitesAccepted,
      onTimePayments,
      punctualPayments,
      fundContributions,
      organizedClosedEvents,
      exemplaryParticipation: Math.min(participationCount, onTimePayments),
      funEvents,
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

  async evaluate(userId: string) {
    const [metrics, ids, awarded] = await Promise.all([
      this.metrics(userId),
      this.syncCatalog(),
      this.db.userAchievement.findMany({
        where: { userId },
        select: { awardedAt: true, level: true, achievement: { select: { code: true } } },
      }),
    ]);
    const awardedMap = new Map(
      awarded.map((row) => [row.achievement.code, { awardedAt: row.awardedAt, level: row.level }]),
    );
    const changes: Array<{
      definition: AchievementDefinition;
      level: AchievementLevel;
      fresh: boolean;
    }> = [];
    for (const definition of ACHIEVEMENTS) {
      const level = levelFor(definition, metrics[definition.metric]);
      if (!level) continue;
      const previous = awardedMap.get(definition.code);
      if (!previous) {
        const achievementId = ids.get(definition.code)!;
        try {
          await this.db.userAchievement.create({
            data: { userId, achievementId, level },
          });
        } catch (error) {
          if ((error as { code?: string })?.code !== 'P2002') throw error;
          const concurrent = await this.db.userAchievement.findUnique({
            where: { userId_achievementId: { userId, achievementId } },
            select: { awardedAt: true, level: true },
          });
          if (!concurrent) throw error;
          awardedMap.set(definition.code, concurrent);
          continue;
        }
        awardedMap.set(definition.code, { awardedAt: new Date(), level });
        changes.push({ definition, level, fresh: true });
      } else if (rankLevel(level) > rankLevel(normalizeLevel(previous.level))) {
        const achievementId = ids.get(definition.code)!;
        await this.db.userAchievement.update({
          where: { userId_achievementId: { userId, achievementId } },
          data: { level },
        });
        awardedMap.set(definition.code, { ...previous, level });
        changes.push({ definition, level, fresh: false });
      }
    }
    if (this.notifications)
      for (const change of changes)
        await this.notifications.notify({
          userIds: [userId],
          type: 'achievement.unlocked',
          title: `${change.fresh ? 'Logro conseguido' : 'Nuevo nivel'}: ${change.definition.name}`,
          body: `${levelLabel(change.level)}: ${change.definition.description}`,
          data: { code: change.definition.code, level: change.level },
          dedupeKey: `achievement:${change.definition.code}:${change.level}`,
        });
    return ACHIEVEMENTS.map((definition) => {
      const value = metrics[definition.metric];
      const currentLevel = levelFor(definition, value);
      const awardedRow = awardedMap.get(definition.code);
      return {
        code: definition.code,
        name: definition.name,
        description: definition.description,
        category: definition.category,
        metric: definition.metric,
        target: definition.thresholds.GOLD,
        progress: Math.min(value, definition.thresholds.GOLD),
        status: awardedRow ? 'UNLOCKED' : value > 0 ? 'IN_PROGRESS' : 'LOCKED',
        currentLevel: currentLevel ?? null,
        points: currentLevel ? LEVEL_POINTS[currentLevel] : 0,
        levels: LEVELS.map((level) => ({
          level,
          threshold: definition.thresholds[level],
          points: LEVEL_POINTS[level],
          achieved: value >= definition.thresholds[level],
        })),
        awardedAt: awardedRow?.awardedAt ?? null,
      };
    });
  }

  async history(userId: string) {
    const rows = await this.db.userAchievement.findMany({
      where: { userId },
      select: {
        awardedAt: true,
        level: true,
        achievement: { select: { code: true, name: true, description: true } },
      },
      orderBy: { awardedAt: 'desc' },
    });
    return rows.map((row) => ({
      ...row.achievement,
      level: normalizeLevel(row.level),
      awardedAt: row.awardedAt,
    }));
  }

  async rankingPrivacy(userId: string) {
    const user = await this.db.user.findUnique({
      where: { id: userId },
      select: { achievementRankingVisible: true },
    });
    return { rankingVisible: user?.achievementRankingVisible !== false };
  }

  async updateRankingPrivacy(userId: string, rankingVisible: boolean) {
    await this.db.user.update({
      where: { id: userId },
      data: { achievementRankingVisible: rankingVisible },
    });
    return { rankingVisible };
  }

  async ranking(userId: string, groupId: string) {
    const membership = await this.db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true },
    });
    if (!membership) return null;
    const members = await this.db.groupMember.findMany({
      where: { groupId },
      select: {
        userId: true,
        user: {
          select: { id: true, displayName: true, avatarUrl: true, achievementRankingVisible: true },
        },
      },
      orderBy: { joinedAt: 'asc' },
    });
    const rows = await Promise.all(
      members
        .filter((member) => member.user.achievementRankingVisible)
        .map(async (member) => {
          const metrics = await this.metrics(member.userId);
          const badges = ACHIEVEMENTS.flatMap((definition) => {
            const level = levelFor(definition, metrics[definition.metric]);
            return level
              ? [
                  {
                    code: definition.code,
                    name: definition.name,
                    level,
                    points: LEVEL_POINTS[level],
                  },
                ]
              : [];
          });
          return {
            user: {
              id: member.user.id,
              displayName: member.user.displayName,
              avatarUrl: member.user.avatarUrl,
            },
            points: badges.reduce((total, badge) => total + badge.points, 0),
            badges,
          };
        }),
    );
    return rows
      .sort(
        (left, right) =>
          right.points - left.points || left.user.displayName.localeCompare(right.user.displayName),
      )
      .slice(0, 20)
      .map((row, index) => ({ ...row, rank: index + 1 }));
  }

  async members(userId: string, groupId: string) {
    const membership = await this.db.groupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { id: true },
    });
    if (!membership) return null;
    const members = await this.db.groupMember.findMany({
      where: { groupId },
      select: { user: { select: { id: true, displayName: true, avatarUrl: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    return Promise.all(
      members.map(async (member) => {
        const metrics = await this.metrics(member.user.id);
        const badges = ACHIEVEMENTS.flatMap((definition) => {
          const level = levelFor(definition, metrics[definition.metric]);
          return level
            ? [{ code: definition.code, name: definition.name, level, points: LEVEL_POINTS[level] }]
            : [];
        });
        return {
          user: member.user,
          points: badges.reduce((total, badge) => total + badge.points, 0),
          badges,
        };
      }),
    );
  }

  async handle(event: DomainEvent): Promise<void> {
    // Cualquier hecho de dominio puede cambiar un agregado mostrado en el ranking.
    this.metricsCache.clear();
    switch (event.type) {
      case 'group.created':
      case 'event.created':
      case 'expense.created':
      case 'personal-expense.created':
      case 'fund.movement':
        await this.evaluate(event.userId);
        return;
      case 'settlement.created': {
        const eventRecord = await this.db.event.findUnique({
          where: { id: event.eventId },
          select: { createdById: true },
        });
        const userIds = new Set(
          [event.userId, eventRecord?.createdById].filter(
            (id): id is string => Boolean(id),
          ),
        );
        await Promise.all([...userIds].map((id) => this.evaluate(id)));
        return;
      }
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

function rankLevel(level: AchievementLevel): number {
  return LEVELS.indexOf(level);
}
function normalizeLevel(value: string): AchievementLevel {
  return value === 'GOLD' || value === 'SILVER' ? value : 'BRONZE';
}
function levelFor(definition: AchievementDefinition, value: number): AchievementLevel | null {
  if (value >= definition.thresholds.GOLD) return 'GOLD';
  if (value >= definition.thresholds.SILVER) return 'SILVER';
  if (value >= definition.thresholds.BRONZE) return 'BRONZE';
  return null;
}
function levelLabel(level: AchievementLevel): string {
  return level === 'BRONZE' ? 'Bronce' : level === 'SILVER' ? 'Plata' : 'Oro';
}
function median(values: number[]): number {
  const middle = Math.floor(values.length / 2);
  return values.length % 2 === 0 ? (values[middle - 1]! + values[middle]!) / 2 : values[middle]!;
}
