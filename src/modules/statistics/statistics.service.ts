import { z } from 'zod';
import type { Database } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import type { BudgetsService } from '../budgets/budgets.service.js';
import type { BudgetsRepository } from '../budgets/budgets.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;
type Variation = {
  currentCents: number;
  previousCents: number;
  absoluteCents: number;
  percentage: number | null;
};

function variation(currentCents: number, previousCents: number): Variation {
  const absoluteCents = currentCents - previousCents;
  return {
    currentCents,
    previousCents,
    absoluteCents,
    percentage:
      previousCents === 0 ? null : Math.round((absoluteCents / previousCents) * 10000) / 100,
  };
}

export const statisticsQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    groupId: z.string().uuid().optional(),
    eventId: z.string().uuid().optional(),
    currency: z
      .string()
      .regex(/^[A-Z]{3}$/)
      .optional(),
  })
  .strict();

export type StatisticsQuery = z.infer<typeof statisticsQuerySchema>;

const CSV_HEADER = [
  'section',
  'label',
  'currency',
  'amountCents',
  'count',
  'shareCents',
  'paidCents',
  'period',
  'groupId',
  'eventId',
  'budgetId',
  'subtotalCents',
  'taxCents',
  'tipCents',
];

/** Escapa RFC 4180 y neutraliza celdas interpretables como fórmulas por hojas de cálculo. */
export function csvCell(value: unknown): string {
  const text = value instanceof Date ? value.toISOString() : String(value ?? '');
  const safe = /^[=+\-@\t\r\n]/.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export interface StatisticsCsvSummary {
  currency: string | null;
  totals: {
    spentCents: number;
    subtotalCents?: number;
    taxCents?: number;
    tipCents?: number;
    expenseCount: number;
    myShareCents: number;
    myPaidCents: number;
  };
  byCategory: Array<{ name: string; totalCents: number; count: number }>;
  byGroup: Array<{ groupId: string; name: string; totalCents: number; count: number }>;
  byEvent: Array<{
    eventId: string;
    name: string;
    groupId: string;
    totalCents: number;
    count: number;
  }>;
  byPerson: Array<{ displayName: string; paidCents: number; shareCents: number }>;
  trend: Array<{ period: string; totalCents: number; myShareCents: number }>;
  budgets: Array<{
    budgetId: string;
    name: string;
    groupId: string;
    amountCents: number;
    spentCents: number;
  }>;
  comparison?: {
    total: Variation;
    byCategory: Array<
      { categoryId: string | null; name: string; color: string | null } & Variation
    >;
  };
  projection?: {
    month: string;
    asOf: Date;
    daysElapsed: number;
    daysRemaining: number;
    currentMonthSpentCents: number;
    dailyRateCents: number;
    recurrentPendingCents: number;
    recurrentPending: Array<{ id: string; title: string; amountCents: number; nextRunAt: Date }>;
    remainingProjectionCents: number;
    projectedMonthTotalCents: number;
    methodology: string;
  };
  incomeSummary?: IncomeSummary;
  monthlyIncomeSummary?: IncomeSummary;
  funds?: Array<{
    fundId: string;
    name: string;
    groupId: string;
    currency: string;
    balanceCents: number;
    contributionsCents: number;
    withdrawalsCents: number;
    adjustmentsCents: number;
    movementCount: number;
  }>;
}

type IncomeSummary = {
  from: Date;
  to: Date;
  incomeCents: number;
  expenseCents: number;
  balanceCents: number;
  byCategory: Array<{ category: string; incomeCents: number; count: number }>;
};

/** Convierte el mismo resumen autorizado del endpoint JSON en un CSV acotado. */
export function buildStatisticsCsv(summary: StatisticsCsvSummary, maxRows: number): string {
  const rows: unknown[][] = [CSV_HEADER];
  const add = (row: unknown[]) => {
    if (rows.length >= maxRows + 1)
      throw new AppError(
        413,
        'STATISTICS_EXPORT_TOO_LARGE',
        'La exportacion excede el limite de filas',
      );
    rows.push(row);
  };
  add([
    'totals',
    'Total gastado',
    summary.currency,
    summary.totals.spentCents,
    summary.totals.expenseCount,
    '',
    '',
    '',
    '',
    '',
    '',
    summary.totals.subtotalCents ?? summary.totals.spentCents,
    summary.totals.taxCents ?? 0,
    summary.totals.tipCents ?? 0,
  ]);
  add(['totals', 'Mi parte', summary.currency, summary.totals.myShareCents]);
  add(['totals', 'Mis pagos', summary.currency, summary.totals.myPaidCents]);
  for (const item of summary.byCategory)
    add(['category', item.name, summary.currency, item.totalCents, item.count]);
  for (const item of summary.byGroup)
    add([
      'group',
      item.name,
      summary.currency,
      item.totalCents,
      item.count,
      '',
      '',
      '',
      item.groupId,
    ]);
  for (const item of summary.byEvent)
    add([
      'event',
      item.name,
      summary.currency,
      item.totalCents,
      item.count,
      '',
      '',
      '',
      item.groupId,
      item.eventId,
    ]);
  for (const item of summary.byPerson)
    add(['person', item.displayName, summary.currency, '', '', item.shareCents, item.paidCents]);
  for (const item of summary.trend)
    add([
      'trend',
      item.period,
      summary.currency,
      item.totalCents,
      '',
      item.myShareCents,
      '',
      item.period,
    ]);
  for (const item of summary.budgets)
    add([
      'budget',
      item.name,
      summary.currency,
      item.amountCents,
      '',
      item.spentCents,
      '',
      '',
      item.groupId,
      '',
      item.budgetId,
    ]);
  for (const item of summary.comparison?.byCategory ?? [])
    add([
      'comparison_category',
      item.name,
      summary.currency,
      item.currentCents,
      '',
      item.previousCents,
      item.absoluteCents,
      item.percentage,
      '',
      '',
      '',
    ]);
  if (summary.comparison)
    add([
      'comparison_total',
      'Variación total',
      summary.currency,
      summary.comparison.total.currentCents,
      '',
      summary.comparison.total.previousCents,
      summary.comparison.total.absoluteCents,
      summary.comparison.total.percentage,
    ]);
  if (summary.projection)
    add([
      'projection',
      'Proyección restante (estimación)',
      summary.currency,
      summary.projection.remainingProjectionCents,
      summary.projection.daysRemaining,
      '',
      summary.projection.recurrentPendingCents,
      '',
    ]);
  if (summary.incomeSummary)
    add(['income', 'Ingresos', summary.currency, summary.incomeSummary.incomeCents]);
  if (summary.monthlyIncomeSummary)
    add([
      'income_month',
      'Saldo mensual ingresos-gastos',
      summary.currency,
      summary.monthlyIncomeSummary.balanceCents,
      '',
      summary.monthlyIncomeSummary.expenseCents,
      summary.monthlyIncomeSummary.incomeCents,
    ]);
  for (const fund of summary.funds ?? [])
    add([
      'fund',
      fund.name,
      fund.currency,
      fund.balanceCents,
      fund.movementCount,
      fund.contributionsCents,
      fund.withdrawalsCents,
      fund.adjustmentsCents,
      fund.groupId,
    ]);
  return rows.map((row) => row.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

type Bucket = { totalCents: number; count: number };

function add<K>(map: Map<K, Bucket>, key: K, cents: number) {
  const bucket = map.get(key) ?? { totalCents: 0, count: 0 };
  bucket.totalCents += cents;
  bucket.count += 1;
  map.set(key, bucket);
}

/** Estadísticas derivadas de gastos reales, limitadas a grupos donde el usuario es miembro. */
export class StatisticsService {
  constructor(
    private readonly db: Database,
    private readonly budgets: BudgetsService,
    private readonly budgetsRepository: BudgetsRepository,
  ) {}

  async summary(userId: string, query: StatisticsQuery) {
    const to = query.to ? new Date(query.to) : new Date();
    const from = query.from ? new Date(query.from) : new Date(to.getTime() - 90 * DAY_MS);
    if (from >= to) throw new AppError(422, 'INVALID_RANGE', 'from debe ser anterior a to');
    if (to.getTime() - from.getTime() > 366 * DAY_MS) {
      throw new AppError(422, 'RANGE_TOO_LARGE', 'El rango maximo es de 366 dias');
    }
    const memberships = await this.db.groupMember.findMany({
      where: { userId, ...(query.groupId ? { groupId: query.groupId } : {}) },
      select: {
        id: true,
        groupId: true,
        role: true,
        group: { select: { name: true, currency: true } },
      },
    });
    if (query.groupId && memberships.length === 0)
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    const groupIds = memberships.map((membership) => membership.groupId);
    const myMembers = new Set(memberships.map((membership) => membership.id));
    const baseWhere = {
      AND: [
        query.groupId || query.eventId
          ? { groupId: { in: groupIds }, ...(query.eventId ? { eventId: query.eventId } : {}) }
          : { OR: [{ ownerUserId: userId }, { groupId: { in: groupIds } }] },
        { occurredAt: { gte: from, lt: to } },
      ],
    };
    const currencies = await this.db.expense.groupBy({
      by: ['currency'],
      where: baseWhere,
      _count: true,
      orderBy: { _count: { currency: 'desc' } },
    });
    const incomeCurrencies = await this.db.income.groupBy({
      by: ['currency'],
      where: { userId, date: { gte: from, lt: to } },
      _count: true,
      orderBy: { _count: { currency: 'desc' } },
    });
    const availableCurrencies = [
      ...new Set([
        ...currencies.map((row) => row.currency),
        ...incomeCurrencies.map((row) => row.currency),
        ...memberships.map((membership) => membership.group.currency),
      ]),
    ];
    const currency = query.currency ?? availableCurrencies[0] ?? null;
    const empty = {
      range: { from, to },
      currency,
      availableCurrencies,
      granularity: 'month' as const,
      totals: {
        spentCents: 0,
        subtotalCents: 0,
        taxCents: 0,
        tipCents: 0,
        expenseCount: 0,
        myShareCents: 0,
        myPaidCents: 0,
        averageExpenseCents: 0,
      },
      byCategory: [],
      byGroup: [],
      byEvent: [],
      byPerson: [],
      trend: [],
      budgets: [],
      comparison: {
        total: variation(0, 0),
        byCategory: [],
      },
      funds: [],
    };
    if (!currency) return empty;

    const expenses = await this.db.expense.findMany({
      where: { ...baseWhere, currency },
      select: {
        totalCents: true,
        subtotalCents: true,
        taxCents: true,
        tipCents: true,
        occurredAt: true,
        groupId: true,
        ownerUserId: true,
        event: { select: { id: true, name: true } },
        category: { select: { id: true, name: true, color: true } },
        participants: {
          select: {
            shareCents: true,
            groupMemberId: true,
            payer: { select: { amountCents: true } },
            eventParticipant: {
              select: {
                guestName: true,
                groupMember: { select: { user: { select: { id: true, displayName: true } } } },
              },
            },
          },
        },
      },
      take: 10_000,
    });
    const previousFrom = new Date(from.getTime() - (to.getTime() - from.getTime()));
    const previousExpenses = await this.db.expense.findMany({
      where: {
        ...baseWhere,
        occurredAt: { gte: previousFrom, lt: from },
        currency,
      },
      select: {
        totalCents: true,
        category: { select: { id: true, name: true, color: true } },
      },
      take: 10_000,
    });

    const granularity = to.getTime() - from.getTime() <= 62 * DAY_MS ? 'week' : 'month';
    const periodKey = (date: Date) => {
      if (granularity === 'month') return date.toISOString().slice(0, 7);
      const monday = new Date(
        Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()),
      );
      monday.setUTCDate(monday.getUTCDate() - ((monday.getUTCDay() + 6) % 7));
      return monday.toISOString().slice(0, 10);
    };
    const groupNames = new Map(
      memberships.map((membership) => [membership.groupId, membership.group.name]),
    );
    const byCategory = new Map<
      string,
      Bucket & { name: string; color: string | null; categoryId: string | null }
    >();
    const byGroup = new Map<string, Bucket>();
    const byEvent = new Map<string, Bucket & { name: string; groupId: string }>();
    const byPerson = new Map<
      string,
      { userId: string | null; displayName: string; paidCents: number; shareCents: number }
    >();
    const trend = new Map<string, { totalCents: number; myShareCents: number }>();
    let spent = 0;
    let subtotal = 0;
    let tax = 0;
    let tip = 0;
    let myShare = 0;
    let myPaid = 0;

    for (const expense of expenses) {
      spent += expense.totalCents;
      subtotal += expense.subtotalCents;
      tax += expense.taxCents;
      tip += expense.tipCents;
      const categoryKey = expense.category?.id ?? 'none';
      const category = byCategory.get(categoryKey) ?? {
        categoryId: expense.category?.id ?? null,
        name: expense.category?.name ?? 'Sin categoría',
        color: expense.category?.color ?? null,
        totalCents: 0,
        count: 0,
      };
      category.totalCents += expense.totalCents;
      category.count += 1;
      byCategory.set(categoryKey, category);
      if (expense.groupId) {
        add(byGroup, expense.groupId, expense.totalCents);
        if (expense.event) {
          const event = byEvent.get(expense.event.id) ?? {
            name: expense.event.name,
            groupId: expense.groupId,
            totalCents: 0,
            count: 0,
          };
          event.totalCents += expense.totalCents;
          event.count += 1;
          byEvent.set(expense.event.id, event);
        }
      } else {
        myShare += expense.totalCents;
        myPaid += expense.totalCents;
      }
      const period = trend.get(periodKey(expense.occurredAt)) ?? { totalCents: 0, myShareCents: 0 };
      period.totalCents += expense.totalCents;
      for (const participant of expense.participants) {
        const paid = participant.payer?.amountCents ?? 0;
        if (participant.groupMemberId && myMembers.has(participant.groupMemberId)) {
          myShare += participant.shareCents;
          myPaid += paid;
          period.myShareCents += participant.shareCents;
        }
        const user = participant.eventParticipant.groupMember?.user;
        const key = user
          ? `u:${user.id}`
          : `g:${expense.groupId ?? 'unknown'}:${participant.eventParticipant.guestName ?? ''}`;
        const person = byPerson.get(key) ?? {
          userId: user?.id ?? null,
          displayName: user?.displayName ?? participant.eventParticipant.guestName ?? 'Invitado',
          paidCents: 0,
          shareCents: 0,
        };
        person.paidCents += paid;
        person.shareCents += participant.shareCents;
        byPerson.set(key, person);
      }
      trend.set(periodKey(expense.occurredAt), period);
    }

    const budgetRows = (
      await Promise.all(
        groupIds.map((groupId) => this.budgetsRepository.budgetsFor(groupId, currency)),
      )
    ).flat();
    const budgets = await Promise.all(
      budgetRows.slice(0, 50).map(async (budget) => {
        const progress = await this.budgets.progress(budget, to);
        return {
          budgetId: budget.id,
          name: budget.name,
          groupId: budget.groupId,
          amountCents: budget.amountCents,
          spentCents: progress.spentCents,
          progressPercent: progress.progressPercent,
          alert: progress.alert,
          periodStart: progress.periodStart,
          periodEnd: progress.periodEnd,
        };
      }),
    );

    const previousByCategory = new Map<string, number>();
    const previousCategoryLabels = new Map<
      string,
      { categoryId: string | null; name: string; color: string | null }
    >();
    for (const expense of previousExpenses) {
      const key = expense.category?.id ?? 'none';
      previousByCategory.set(key, (previousByCategory.get(key) ?? 0) + expense.totalCents);
      previousCategoryLabels.set(key, {
        categoryId: expense.category?.id ?? null,
        name: expense.category?.name ?? 'Sin categoría',
        color: expense.category?.color ?? null,
      });
    }
    const comparisonCategoryKeys = new Set([...byCategory.keys(), ...previousByCategory.keys()]);
    const comparisonByCategory = [...comparisonCategoryKeys]
      .map((key) => {
        const current = byCategory.get(key);
        const previous = previousCategoryLabels.get(key);
        const currentCents = current?.totalCents ?? 0;
        const previousCents = previousByCategory.get(key) ?? 0;
        return {
          categoryId: current?.categoryId ?? previous?.categoryId ?? null,
          name: current?.name ?? previous?.name ?? 'Sin categoría',
          color: current?.color ?? previous?.color ?? null,
          ...variation(currentCents, previousCents),
        };
      })
      .sort((a, b) => b.currentCents - a.currentCents || b.previousCents - a.previousCents);
    const previousTotal = previousExpenses.reduce(
      (total, expense) => total + expense.totalCents,
      0,
    );

    const incomeRows = await this.db.income.findMany({
      where: { userId, date: { gte: from, lt: to }, currency },
      select: { amountCents: true, category: true },
      take: 10_000,
    });
    const incomeSummary = this.incomeSummary(from, to, incomeRows, spent);
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [monthlyIncomeRows, monthlyExpense] = await Promise.all([
      this.db.income.findMany({
        where: { userId, date: { gte: monthStart, lt: monthEnd }, currency },
        select: { amountCents: true, category: true },
        take: 10_000,
      }),
      this.db.expense.aggregate({
        where: {
          groupId: { in: groupIds },
          occurredAt: { gte: monthStart, lt: now },
          currency,
        },
        _sum: { totalCents: true },
      }),
    ]);
    const monthlyIncomeSummary = this.incomeSummary(
      monthStart,
      monthEnd,
      monthlyIncomeRows,
      monthlyExpense._sum.totalCents ?? 0,
    );
    const [projection, funds] = await Promise.all([
      this.monthProjection(groupIds, currency, now),
      this.fundStatistics(memberships, currency),
    ]);

    return {
      range: { from, to },
      currency,
      availableCurrencies,
      granularity,
      totals: {
        spentCents: spent,
        subtotalCents: subtotal,
        taxCents: tax,
        tipCents: tip,
        expenseCount: expenses.length,
        myShareCents: myShare,
        myPaidCents: myPaid,
        averageExpenseCents: expenses.length ? Math.round(spent / expenses.length) : 0,
      },
      byCategory: [...byCategory.values()].sort((a, b) => b.totalCents - a.totalCents),
      byGroup: [...byGroup.entries()]
        .map(([groupId, bucket]) => ({ groupId, name: groupNames.get(groupId) ?? '', ...bucket }))
        .sort((a, b) => b.totalCents - a.totalCents),
      byEvent: [...byEvent.entries()]
        .map(([eventId, bucket]) => ({ eventId, ...bucket }))
        .sort((a, b) => b.totalCents - a.totalCents)
        .slice(0, 10),
      byPerson: [...byPerson.values()].sort((a, b) => b.shareCents - a.shareCents).slice(0, 20),
      trend: [...trend.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([period, value]) => ({ period, ...value })),
      budgets,
      comparison: {
        period: { from: previousFrom, to: from },
        total: variation(spent, previousTotal),
        byCategory: comparisonByCategory,
      },
      projection,
      incomeSummary,
      monthlyIncomeSummary,
      funds,
    };
  }

  private incomeSummary(
    from: Date,
    to: Date,
    rows: Array<{ amountCents: number; category: string }>,
    expenseCents: number,
  ): IncomeSummary {
    const byCategory = new Map<string, { incomeCents: number; count: number }>();
    let incomeCents = 0;
    for (const row of rows) {
      incomeCents += row.amountCents;
      const bucket = byCategory.get(row.category) ?? { incomeCents: 0, count: 0 };
      bucket.incomeCents += row.amountCents;
      bucket.count += 1;
      byCategory.set(row.category, bucket);
    }
    return {
      from,
      to,
      incomeCents,
      expenseCents,
      balanceCents: incomeCents - expenseCents,
      byCategory: [...byCategory.entries()]
        .map(([category, value]) => ({ category, ...value }))
        .sort((a, b) => b.incomeCents - a.incomeCents),
    };
  }

  /**
   * Estima solo el mes calendario actual: gasto acumulado / días transcurridos,
   * más una vez cada recurrente activo cuyo nextRunAt esté en lo que queda del mes.
   * No interpreta frequency ni crea ejecuciones; así tolera el modelo P4 existente.
   */
  private async monthProjection(groupIds: string[], currency: string, now: Date) {
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const daysInMonth = Math.round((monthEnd.getTime() - monthStart.getTime()) / DAY_MS);
    const elapsedDays = Math.max(
      1,
      Math.min(daysInMonth, Math.floor((now.getTime() - monthStart.getTime()) / DAY_MS) + 1),
    );
    const [spent, recurring] = await Promise.all([
      this.db.expense.aggregate({
        where: {
          groupId: { in: groupIds },
          currency,
          occurredAt: { gte: monthStart, lt: now },
        },
        _sum: { totalCents: true },
      }),
      this.db.recurringExpense.findMany({
        where: {
          groupId: { in: groupIds },
          currency,
          isActive: true,
          nextRunAt: { gt: now, lt: monthEnd },
        },
        select: { id: true, title: true, amountCents: true, nextRunAt: true },
        orderBy: { nextRunAt: 'asc' },
        take: 500,
      }),
    ]);
    const currentMonthSpentCents = spent._sum.totalCents ?? 0;
    const recurrentPending = recurring.filter(
      (item) => Number.isSafeInteger(item.amountCents) && item.amountCents > 0,
    );
    const recurrentPendingCents = recurrentPending.reduce(
      (total, item) => total + item.amountCents,
      0,
    );
    const dailyRateCents = Math.round(currentMonthSpentCents / elapsedDays);
    const daysRemaining = Math.max(0, daysInMonth - elapsedDays);
    const remainingProjectionCents = dailyRateCents * daysRemaining + recurrentPendingCents;
    return {
      month: monthStart.toISOString().slice(0, 7),
      asOf: now,
      daysElapsed: elapsedDays,
      daysRemaining,
      currentMonthSpentCents,
      dailyRateCents,
      recurrentPendingCents,
      recurrentPending: recurrentPending.map(({ id, title, amountCents, nextRunAt }) => ({
        id,
        title,
        amountCents,
        nextRunAt,
      })),
      remainingProjectionCents,
      projectedMonthTotalCents: currentMonthSpentCents + remainingProjectionCents,
      methodology:
        'Estimación: gasto del mes actual dividido entre días transcurridos, multiplicado por días restantes, más recurrentes activos pendientes del mes. No es un dato real ni ejecuta recurrentes.',
    };
  }

  private async fundStatistics(
    memberships: Array<{ id: string; groupId: string; role: string }>,
    currency: string,
  ) {
    const memberIds = memberships.map((membership) => membership.id);
    const managedGroupIds = memberships
      .filter((membership) => membership.role === 'OWNER' || membership.role === 'ADMIN')
      .map((membership) => membership.groupId);
    const funds = await this.db.fund.findMany({
      where: {
        groupId: { in: [...new Set(memberships.map((membership) => membership.groupId))] },
        currency,
        OR: [
          { members: { some: { groupMemberId: { in: memberIds } } } },
          { groupId: { in: managedGroupIds } },
        ],
      },
      select: { id: true, groupId: true, name: true, currency: true },
      orderBy: { name: 'asc' },
      take: 200,
    });
    if (funds.length === 0) return [];
    const movements = await this.db.fundMovement.findMany({
      where: { fundId: { in: funds.map((fund) => fund.id) } },
      select: { fundId: true, type: true, amountCents: true },
      take: 20_000,
    });
    return funds.map((fund) => {
      const rows = movements.filter((movement) => movement.fundId === fund.id);
      const contributionsCents = rows
        .filter((movement) => movement.type === 'CONTRIBUTION')
        .reduce((total, movement) => total + movement.amountCents, 0);
      const withdrawalsCents = rows
        .filter((movement) => movement.type === 'WITHDRAWAL')
        .reduce((total, movement) => total + Math.abs(movement.amountCents), 0);
      const adjustmentsCents = rows
        .filter((movement) => movement.type === 'ADJUSTMENT')
        .reduce((total, movement) => total + movement.amountCents, 0);
      return {
        fundId: fund.id,
        name: fund.name,
        groupId: fund.groupId,
        currency: fund.currency,
        balanceCents: contributionsCents - withdrawalsCents + adjustmentsCents,
        contributionsCents,
        withdrawalsCents,
        adjustmentsCents,
        movementCount: rows.length,
      };
    });
  }

  async exportCsv(userId: string, query: StatisticsQuery, maxRows: number) {
    const summary = await this.summary(userId, query);
    const csv = buildStatisticsCsv(summary, maxRows);
    return { csv, currency: summary.currency };
  }
}
