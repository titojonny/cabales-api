import type { Prisma } from '@prisma/client';
import type { Database } from '../../database/client.js';
import { requestHash } from '../../shared/crypto.js';
import { AppError, ensure } from '../../shared/errors.js';
import { assertCurrency } from '../../shared/money.js';
import type { DomainEvents } from '../../shared/events.js';
import type {
  CreatePersonalExpenseInput,
  ExpenseHistoryQuery,
  UpdatePersonalExpenseInput,
} from './expenses.schema.js';

const personalExpenseView = {
  id: true,
  groupId: true,
  eventId: true,
  ownerUserId: true,
  title: true,
  notes: true,
  totalCents: true,
  subtotalCents: true,
  taxCents: true,
  tipCents: true,
  currency: true,
  splitMode: true,
  occurredAt: true,
  createdAt: true,
  categoryId: true,
  category: { select: { id: true, name: true, color: true } },
  tags: { select: { tag: { select: { id: true, name: true, groupId: true, ownerUserId: true } } } },
} as const;

function periodFromMonth(month?: string) {
  if (!month) return undefined;
  const [year, monthNumber] = month.split('-').map(Number);
  return {
    gte: new Date(Date.UTC(year!, monthNumber! - 1, 1)),
    lt: new Date(Date.UTC(year!, monthNumber!, 1)),
  };
}

/** Gastos personales e historial autorizado de gastos propios y de grupos visibles. */
export class PersonalExpensesService {
  constructor(
    private readonly db: Database,
    private readonly events?: DomainEvents,
  ) {}

  private async validateReferences(
    userId: string,
    input: {
      categoryId?: string | null | undefined;
      tagIds?: string[] | undefined;
    },
  ) {
    if (input.categoryId) {
      const category = await this.db.category.findFirst({
        where: {
          id: input.categoryId,
          OR: [{ ownerUserId: userId }, { groupId: null, ownerUserId: null }],
        },
        select: { id: true },
      });
      ensure(
        category,
        422,
        'CATEGORY_OUTSIDE_PERSONAL_SCOPE',
        'La categoria no pertenece a tus gastos',
      );
    }
    const tagIds = input.tagIds ?? [];
    ensure(
      new Set(tagIds).size === tagIds.length,
      422,
      'DUPLICATE_TAG',
      'Hay etiquetas duplicadas',
    );
    if (tagIds.length > 0) {
      const tags = await this.db.tag.findMany({
        where: { id: { in: tagIds }, ownerUserId: userId },
        select: { id: true },
      });
      ensure(
        tags.length === tagIds.length,
        422,
        'TAG_OUTSIDE_PERSONAL_SCOPE',
        'Una etiqueta no pertenece a tus gastos',
      );
    }
  }

  async create(userId: string, key: string, requestId: string, input: CreatePersonalExpenseInput) {
    assertCurrency(input.currency);
    await this.validateReferences(userId, input);
    const hash = requestHash(input);
    const scope = 'expense:personal:create';
    const result = await this.db.$transaction(async (tx) => {
      const now = new Date();
      const replay = await tx.idempotencyKey.findUnique({
        where: { userId_scope_key: { userId, scope, key } },
      });
      if (replay && replay.expiresAt > now) {
        ensure(
          replay.requestHash === hash,
          409,
          'IDEMPOTENCY_CONFLICT',
          'La llave ya se uso con otra solicitud',
        );
        return { data: replay.responseBody, replayed: true };
      }
      if (replay) await tx.idempotencyKey.delete({ where: { id: replay.id } });
      const expense = await tx.expense.create({
        data: {
          groupId: null,
          eventId: null,
          ownerUserId: userId,
          createdById: userId,
          title: input.title,
          ...(input.notes ? { notes: input.notes } : {}),
          ...(input.categoryId ? { categoryId: input.categoryId } : {}),
          totalCents: input.totalCents,
          subtotalCents: input.totalCents,
          taxCents: 0,
          tipCents: 0,
          currency: input.currency,
          splitMode: 'EQUAL',
          occurredAt: input.occurredAt,
          ...(input.tagIds && input.tagIds.length > 0
            ? { tags: { create: input.tagIds.map((tagId) => ({ tagId })) } }
            : {}),
        },
        select: personalExpenseView,
      });
      const json = JSON.parse(JSON.stringify(expense)) as Prisma.InputJsonValue;
      await tx.idempotencyKey.create({
        data: {
          userId,
          scope,
          key,
          requestHash: hash,
          responseStatus: 201,
          responseBody: json,
          resourceId: expense.id,
          expiresAt: new Date(now.getTime() + 24 * 60 * 60 * 1000),
        },
      });
      await tx.auditLog.create({
        data: {
          userId,
          action: 'personal_expense.created',
          entityType: 'Expense',
          entityId: expense.id,
          requestId,
          metadata: { totalCents: input.totalCents, currency: input.currency },
        },
      });
      return { data: expense, replayed: false };
    });
    if (!result.replayed) {
      const expenseId = (result.data as { id?: string } | null)?.id;
      if (expenseId) this.events?.emit({ type: 'personal-expense.created', expenseId, userId });
    }
    return result;
  }

  private async membershipGroupIds(userId: string, groupId?: string) {
    const rows = await this.db.groupMember.findMany({
      where: { userId, ...(groupId ? { groupId } : {}) },
      select: { groupId: true },
    });
    if (groupId && rows.length === 0)
      throw new AppError(404, 'GROUP_NOT_FOUND', 'Grupo no encontrado');
    return rows.map((row) => row.groupId);
  }

  async history(userId: string, query: ExpenseHistoryQuery) {
    const groupIds = await this.membershipGroupIds(userId, query.groupId);
    const monthRange = periodFromMonth(query.month);
    const from = query.from ? new Date(query.from) : monthRange?.gte;
    const to = query.to ? new Date(query.to) : monthRange?.lt;
    if (from && to && from >= to)
      throw new AppError(422, 'INVALID_RANGE', 'from debe ser anterior a to');
    const scope =
      query.scope === 'PERSONAL'
        ? { ownerUserId: userId }
        : query.scope === 'GROUPS' || query.groupId
          ? { groupId: query.groupId ? query.groupId : { in: groupIds } }
          : { OR: [{ ownerUserId: userId }, { groupId: { in: groupIds } }] };
    const where = {
      AND: [
        scope,
        ...(query.text
          ? [
              {
                OR: [
                  { title: { contains: query.text, mode: 'insensitive' as const } },
                  { notes: { contains: query.text, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.tagId ? { tags: { some: { tagId: query.tagId } } } : {}),
      ...(from || to
        ? { occurredAt: { ...(from ? { gte: from } : {}), ...(to ? { lt: to } : {}) } }
        : {}),
    } satisfies Prisma.ExpenseWhereInput;
    const [totalCount, total, rows] = await Promise.all([
      this.db.expense.count({ where }),
      this.db.expense.aggregate({ where, _sum: { totalCents: true } }),
      this.db.expense.findMany({
        where,
        select: {
          id: true,
          groupId: true,
          eventId: true,
          ownerUserId: true,
          title: true,
          notes: true,
          totalCents: true,
          subtotalCents: true,
          taxCents: true,
          tipCents: true,
          currency: true,
          splitMode: true,
          occurredAt: true,
          createdAt: true,
          categoryId: true,
          category: { select: { id: true, name: true, color: true } },
          tags: { select: { tag: { select: { id: true, name: true } } } },
          group: { select: { id: true, name: true } },
          event: { select: { id: true, name: true } },
        },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }],
        take: query.limit + 1,
        ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
      }),
    ]);
    const items = rows.slice(0, query.limit);
    return {
      items,
      total: total._sum.totalCents ?? 0,
      totalCount,
      nextCursor: rows.length > query.limit ? (items.at(-1)?.id ?? null) : null,
    };
  }

  async detail(userId: string, expenseId: string) {
    const groupIds = await this.membershipGroupIds(userId);
    const expense = await this.db.expense.findFirst({
      where: { id: expenseId, OR: [{ ownerUserId: userId }, { groupId: { in: groupIds } }] },
      select: personalExpenseView,
    });
    ensure(expense, 404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado');
    return expense;
  }

  async update(userId: string, expenseId: string, input: UpdatePersonalExpenseInput) {
    const current = await this.db.expense.findFirst({
      where: { id: expenseId, ownerUserId: userId },
      select: { id: true },
    });
    ensure(current, 404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado');
    await this.validateReferences(userId, input);
    if (input.currency) assertCurrency(input.currency);
    const updated = await this.db.expense.update({
      where: { id: expenseId },
      data: {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.notes !== undefined ? { notes: input.notes || null } : {}),
        ...(input.totalCents !== undefined
          ? {
              totalCents: input.totalCents,
              subtotalCents: input.totalCents,
              taxCents: 0,
              tipCents: 0,
            }
          : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
        ...(input.occurredAt !== undefined ? { occurredAt: input.occurredAt } : {}),
        ...(input.categoryId !== undefined ? { categoryId: input.categoryId || null } : {}),
        ...(input.tagIds !== undefined
          ? { tags: { deleteMany: {}, create: input.tagIds.map((tagId) => ({ tagId })) } }
          : {}),
      },
      select: personalExpenseView,
    });
    return updated;
  }

  async delete(userId: string, expenseId: string) {
    const result = await this.db.expense.deleteMany({
      where: { id: expenseId, ownerUserId: userId },
    });
    ensure(result.count === 1, 404, 'EXPENSE_NOT_FOUND', 'Gasto no encontrado');
  }
}
