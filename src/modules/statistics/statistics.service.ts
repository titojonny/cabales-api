import { z } from 'zod';
import type { Database } from '../../database/client.js';
import { AppError } from '../../shared/errors.js';
import type { BudgetsService } from '../budgets/budgets.service.js';
import type { BudgetsRepository } from '../budgets/budgets.repository.js';

const DAY_MS = 24 * 60 * 60 * 1000;

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
    expenseCount: number;
    myShareCents: number;
    myPaidCents: number;
  };
  byCategory: Array<{ name: string; totalCents: number; count: number }>;
  byGroup: Array<{ groupId: string; name: string; totalCents: number; count: number }>;
  byEvent: Array<{ eventId: string; name: string; groupId: string; totalCents: number; count: number }>;
  byPerson: Array<{ displayName: string; paidCents: number; shareCents: number }>;
  trend: Array<{ period: string; totalCents: number; myShareCents: number }>;
  budgets: Array<{
    budgetId: string;
    name: string;
    groupId: string;
    amountCents: number;
    spentCents: number;
  }>;
}

/** Convierte el mismo resumen autorizado del endpoint JSON en un CSV acotado. */
export function buildStatisticsCsv(summary: StatisticsCsvSummary, maxRows: number): string {
  const rows: unknown[][] = [CSV_HEADER];
  const add = (row: unknown[]) => {
    if (rows.length >= maxRows + 1)
      throw new AppError(413, 'STATISTICS_EXPORT_TOO_LARGE', 'La exportacion excede el limite de filas');
    rows.push(row);
  };
  add(['totals', 'Total gastado', summary.currency, summary.totals.spentCents, summary.totals.expenseCount]);
  add(['totals', 'Mi parte', summary.currency, summary.totals.myShareCents]);
  add(['totals', 'Mis pagos', summary.currency, summary.totals.myPaidCents]);
  for (const item of summary.byCategory)
    add(['category', item.name, summary.currency, item.totalCents, item.count]);
  for (const item of summary.byGroup)
    add(['group', item.name, summary.currency, item.totalCents, item.count, '', '', '', item.groupId]);
  for (const item of summary.byEvent)
    add(['event', item.name, summary.currency, item.totalCents, item.count, '', '', '', item.groupId, item.eventId]);
  for (const item of summary.byPerson)
    add(['person', item.displayName, summary.currency, '', '', item.shareCents, item.paidCents]);
  for (const item of summary.trend)
    add(['trend', item.period, summary.currency, item.totalCents, '', item.myShareCents, '', item.period]);
  for (const item of summary.budgets)
    add(['budget', item.name, summary.currency, item.amountCents, '', item.spentCents, '', '', item.groupId, '', item.budgetId]);
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
      select: { id: true, groupId: true, group: { select: { name: true } } },
    });
    if (query.groupId && memberships.length === 0)
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    const groupIds = memberships.map((membership) => membership.groupId);
    const myMembers = new Set(memberships.map((membership) => membership.id));
    const baseWhere = {
      groupId: { in: groupIds },
      occurredAt: { gte: from, lt: to },
      ...(query.eventId ? { eventId: query.eventId } : {}),
    };
    const currencies = await this.db.expense.groupBy({
      by: ['currency'],
      where: baseWhere,
      _count: true,
      orderBy: { _count: { currency: 'desc' } },
    });
    const availableCurrencies = currencies.map((row) => row.currency);
    const currency = query.currency ?? availableCurrencies[0] ?? null;
    const empty = {
      range: { from, to },
      currency,
      availableCurrencies,
      granularity: 'month' as const,
      totals: {
        spentCents: 0,
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
    };
    if (!currency) return empty;

    const expenses = await this.db.expense.findMany({
      where: { ...baseWhere, currency },
      select: {
        totalCents: true,
        occurredAt: true,
        groupId: true,
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
    let myShare = 0;
    let myPaid = 0;

    for (const expense of expenses) {
      spent += expense.totalCents;
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
      add(byGroup, expense.groupId, expense.totalCents);
      const event = byEvent.get(expense.event.id) ?? {
        name: expense.event.name,
        groupId: expense.groupId,
        totalCents: 0,
        count: 0,
      };
      event.totalCents += expense.totalCents;
      event.count += 1;
      byEvent.set(expense.event.id, event);
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
          : `g:${expense.groupId}:${participant.eventParticipant.guestName ?? ''}`;
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

    return {
      range: { from, to },
      currency,
      availableCurrencies,
      granularity,
      totals: {
        spentCents: spent,
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
    };
  }

  async exportCsv(userId: string, query: StatisticsQuery, maxRows: number) {
    const summary = await this.summary(userId, query);
    const csv = buildStatisticsCsv(summary, maxRows);
    return { csv, currency: summary.currency };
  }
}
