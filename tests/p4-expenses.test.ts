import { describe, expect, it, vi } from 'vitest';
import { PersonalExpensesService } from '../src/modules/expenses/personal-expenses.service.js';
import type { Database } from '../src/database/client.js';

describe('P4 gastos personales', () => {
  it('consulta por propietario y no entrega un gasto de otra cuenta', async () => {
    const db = {
      groupMember: { findMany: vi.fn(async () => []) },
      expense: { findFirst: vi.fn(async () => null) },
    } as unknown as Database;
    const service = new PersonalExpensesService(db);
    await expect(
      service.detail(
        '10000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000002',
      ),
    ).rejects.toMatchObject({
      code: 'EXPENSE_NOT_FOUND',
      status: 404,
    });
    expect(db.expense.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          OR: [{ ownerUserId: '10000000-0000-4000-8000-000000000001' }, { groupId: { in: [] } }],
        }),
      }),
    );
  });

  it('mantiene el total del filtro separado del contador de filas', async () => {
    const db = {
      groupMember: { findMany: vi.fn(async () => []) },
      expense: {
        count: vi.fn(async () => 2),
        aggregate: vi.fn(async () => ({ _sum: { totalCents: 1234 } })),
        findMany: vi.fn(async () => []),
      },
    } as unknown as Database;
    const service = new PersonalExpensesService(db);
    const result = await service.history('10000000-0000-4000-8000-000000000001', {
      scope: 'PERSONAL',
      month: '2026-10',
      limit: 30,
    });
    expect(result).toMatchObject({ total: 1234, totalCount: 2, items: [] });
    expect(db.expense.aggregate).toHaveBeenCalledOnce();
  });
});
