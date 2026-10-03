import type { Database } from '../../database/client.js';
import type { CreateIncomeInput, UpdateIncomeInput } from './incomes.schema.js';

const incomeView = {
  id: true,
  amountCents: true,
  date: true,
  category: true,
  note: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
} as const;

export class IncomesRepository {
  constructor(private readonly db: Database) {}

  list(
    userId: string,
    input: {
      from?: Date | undefined;
      to?: Date | undefined;
      currency?: string | undefined;
      limit: number;
    },
  ) {
    return this.db.income.findMany({
      where: {
        userId,
        ...(input.from || input.to
          ? {
              date: {
                ...(input.from ? { gte: input.from } : {}),
                ...(input.to ? { lt: input.to } : {}),
              },
            }
          : {}),
        ...(input.currency ? { currency: input.currency } : {}),
      },
      select: incomeView,
      orderBy: [{ date: 'desc' }, { id: 'desc' }],
      take: input.limit,
    });
  }

  find(userId: string, id: string) {
    return this.db.income.findFirst({ where: { id, userId }, select: incomeView });
  }

  create(userId: string, input: CreateIncomeInput) {
    return this.db.income.create({
      data: {
        userId,
        amountCents: input.amountCents,
        date: new Date(input.date),
        category: input.category,
        ...(input.note !== undefined ? { note: input.note } : {}),
        currency: input.currency,
      },
      select: incomeView,
    });
  }

  update(userId: string, id: string, input: UpdateIncomeInput) {
    return this.db.income.updateMany({
      where: { id, userId },
      data: {
        ...(input.amountCents !== undefined ? { amountCents: input.amountCents } : {}),
        ...(input.date !== undefined ? { date: new Date(input.date) } : {}),
        ...(input.category !== undefined ? { category: input.category } : {}),
        ...(input.note !== undefined ? { note: input.note } : {}),
        ...(input.currency !== undefined ? { currency: input.currency } : {}),
      },
    });
  }

  remove(userId: string, id: string) {
    return this.db.income.deleteMany({ where: { id, userId } });
  }
}
