import { GroupRole, type BudgetPeriod } from '@prisma/client';
import { ensure } from '../../shared/errors.js';
import { periodWindow, recentWindows } from '../../shared/periods.js';
import type { GroupsService } from '../groups/groups.service.js';
import type { BudgetRow, BudgetsRepository } from './budgets.repository.js';
import type { CreateBudgetInput, UpdateBudgetInput } from './budgets.schema.js';

const ALL_ROLES = [GroupRole.OWNER, GroupRole.ADMIN, GroupRole.MEMBER] as const;
const MANAGERS = [GroupRole.OWNER, GroupRole.ADMIN] as const;

/** Estado de alerta del periodo según el umbral configurado. */
export type BudgetAlert = 'OK' | 'WARNING' | 'EXCEEDED';

/** Presupuestos por periodo con consumo, progreso, excedente y alerta derivados. */
export class BudgetsService {
  constructor(
    private readonly repository: BudgetsRepository,
    private readonly groups: GroupsService,
  ) {}

  /** Progreso del periodo que contiene `at`. */
  async progress(budget: BudgetRow, at: Date) {
    const window = periodWindow(budget, at);
    const { spentCents, expenseCount } = await this.repository.spent(
      budget.groupId,
      budget.currency,
      budget.category?.id ?? null,
      window.start,
      window.end,
    );
    const percent = Math.round((spentCents / budget.amountCents) * 1000) / 10;
    const alert: BudgetAlert =
      spentCents > budget.amountCents
        ? 'EXCEEDED'
        : percent >= budget.alertThresholdPercent
          ? 'WARNING'
          : 'OK';
    return {
      periodStart: window.start,
      periodEnd: window.end,
      periodState: window.state,
      spentCents,
      expenseCount,
      remainingCents: Math.max(0, budget.amountCents - spentCents),
      overspentCents: Math.max(0, spentCents - budget.amountCents),
      progressPercent: percent,
      alert,
    };
  }

  private async present(budget: BudgetRow, at: Date) {
    return { ...budget, current: await this.progress(budget, at) };
  }

  async list(userId: string, groupId: string, at = new Date()) {
    await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const budgets = await this.repository.list(groupId);
    return Promise.all(budgets.map((budget) => this.present(budget, at)));
  }

  async detail(userId: string, groupId: string, budgetId: string, at = new Date()) {
    await this.groups.requireRole(userId, groupId, ALL_ROLES);
    const budget = await this.repository.find(groupId, budgetId);
    ensure(budget, 404, 'BUDGET_NOT_FOUND', 'Presupuesto no encontrado');
    const history = await Promise.all(
      recentWindows(budget, at, 6).map(async (window) => ({
        periodStart: window.start,
        periodEnd: window.end,
        ...(await this.repository.spent(
          budget.groupId,
          budget.currency,
          budget.category?.id ?? null,
          window.start,
          window.end,
        )),
      })),
    );
    return { ...(await this.present(budget, at)), history };
  }

  async create(userId: string, groupId: string, input: CreateBudgetInput) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const group = await this.repository.groupCurrency(groupId);
    ensure(group, 404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    if (input.categoryId) await this.groups.assertCategory(groupId, input.categoryId);
    const budget = await this.repository.create({
      groupId,
      name: input.name,
      amountCents: input.amountCents,
      currency: group.currency,
      period: input.period as BudgetPeriod,
      startsAt: input.startsAt,
      endsAt: input.endsAt ?? null,
      categoryId: input.categoryId ?? null,
      alertThresholdPercent: input.alertThresholdPercent,
      createdById: userId,
    });
    return this.present(budget, new Date());
  }

  async update(userId: string, groupId: string, budgetId: string, input: UpdateBudgetInput) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const budget = await this.repository.find(groupId, budgetId);
    ensure(budget, 404, 'BUDGET_NOT_FOUND', 'Presupuesto no encontrado');
    if (input.categoryId) await this.groups.assertCategory(groupId, input.categoryId);
    const endsAt = input.endsAt === undefined ? budget.endsAt : input.endsAt;
    ensure(
      !endsAt || endsAt > budget.startsAt,
      422,
      'INVALID_PERIOD',
      'endsAt debe ser posterior a startsAt',
    );
    ensure(budget.period !== 'CUSTOM' || endsAt, 422, 'INVALID_PERIOD', 'CUSTOM requiere endsAt');
    const updated = await this.repository.update(budgetId, {
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
      ...(input.endsAt !== undefined ? { endsAt: input.endsAt } : {}),
      ...(input.categoryId !== undefined ? { categoryId: input.categoryId } : {}),
      ...(input.alertThresholdPercent !== undefined
        ? { alertThresholdPercent: input.alertThresholdPercent }
        : {}),
    });
    return this.present(updated, new Date());
  }

  async remove(userId: string, groupId: string, budgetId: string) {
    await this.groups.requireRole(userId, groupId, MANAGERS);
    const removed = await this.repository.delete(groupId, budgetId);
    ensure(removed.count === 1, 404, 'BUDGET_NOT_FOUND', 'Presupuesto no encontrado');
  }

  /** Presupuestos afectados por un gasto nuevo con su progreso en el periodo del gasto. */
  async affectedBy(expenseId: string) {
    const expense = await this.repository.expense(expenseId);
    if (!expense || !expense.groupId) return [];
    const budgets = await this.repository.budgetsFor(expense.groupId, expense.currency);
    const affected = budgets.filter(
      (budget) => !budget.category || budget.category.id === expense.categoryId,
    );
    const results = [];
    for (const budget of affected) {
      const window = periodWindow(budget, expense.occurredAt);
      if (window.state !== 'ACTIVE') continue;
      results.push({ budget, progress: await this.progress(budget, expense.occurredAt) });
    }
    return results;
  }
}
