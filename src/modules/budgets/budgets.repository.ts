import type { Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';

export const budgetView = {
  id: true,
  groupId: true,
  name: true,
  amountCents: true,
  currency: true,
  period: true,
  startsAt: true,
  endsAt: true,
  alertThresholdPercent: true,
  createdAt: true,
  updatedAt: true,
  category: { select: { id: true, name: true, color: true } },
} as const;

export type BudgetRow = Prisma.BudgetGetPayload<{ select: typeof budgetView }>;

/** Persistencia de presupuestos; el consumo se deriva de gastos. */
export class BudgetsRepository {
  constructor(private readonly db: Database) {}

  groupCurrency(groupId: string) {
    return this.db.group.findUnique({ where: { id: groupId }, select: { currency: true } });
  }

  list(groupId: string) {
    return this.db.budget.findMany({
      where: { groupId },
      select: budgetView,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  find(groupId: string, budgetId: string) {
    return this.db.budget.findFirst({ where: { id: budgetId, groupId }, select: budgetView });
  }

  create(data: Prisma.BudgetUncheckedCreateInput) {
    return this.db.budget.create({ data, select: budgetView });
  }

  update(budgetId: string, data: Prisma.BudgetUncheckedUpdateInput) {
    return this.db.budget.update({ where: { id: budgetId }, data, select: budgetView });
  }

  delete(groupId: string, budgetId: string) {
    return this.db.budget.deleteMany({ where: { id: budgetId, groupId } });
  }

  async spent(
    groupId: string,
    currency: string,
    categoryId: string | null,
    start: Date,
    end: Date,
  ) {
    const result = await this.db.expense.aggregate({
      where: {
        groupId,
        currency,
        occurredAt: { gte: start, lt: end },
        ...(categoryId ? { categoryId } : {}),
      },
      _sum: { totalCents: true },
      _count: true,
    });
    return { spentCents: result._sum.totalCents ?? 0, expenseCount: result._count };
  }

  expense(expenseId: string) {
    return this.db.expense.findUnique({
      where: { id: expenseId },
      select: { groupId: true, currency: true, categoryId: true, occurredAt: true },
    });
  }

  budgetsFor(groupId: string, currency: string) {
    return this.db.budget.findMany({ where: { groupId, currency }, select: budgetView });
  }
}
