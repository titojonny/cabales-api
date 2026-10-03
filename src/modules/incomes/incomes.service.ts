import { AppError, ensure } from '../../shared/errors.js';
import type { CreateIncomeInput, IncomeQuery, UpdateIncomeInput } from './incomes.schema.js';
import type { IncomesRepository } from './incomes.repository.js';

export class IncomesService {
  constructor(private readonly repository: IncomesRepository) {}

  list(userId: string, query: IncomeQuery) {
    const from = query.from ? new Date(query.from) : undefined;
    const to = query.to ? new Date(query.to) : undefined;
    if (from && to && from >= to)
      throw new AppError(422, 'INVALID_RANGE', 'from debe ser anterior a to');
    return this.repository.list(userId, { from, to, currency: query.currency, limit: query.limit });
  }

  create(userId: string, input: CreateIncomeInput) {
    return this.repository.create(userId, input);
  }

  async update(userId: string, id: string, input: UpdateIncomeInput) {
    const result = await this.repository.update(userId, id, input);
    ensure(result.count === 1, 404, 'INCOME_NOT_FOUND', 'Ingreso no encontrado');
    const income = await this.repository.find(userId, id);
    ensure(income, 404, 'INCOME_NOT_FOUND', 'Ingreso no encontrado');
    return income;
  }

  async remove(userId: string, id: string) {
    const result = await this.repository.remove(userId, id);
    ensure(result.count === 1, 404, 'INCOME_NOT_FOUND', 'Ingreso no encontrado');
  }
}
