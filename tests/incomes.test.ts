import { describe, expect, it, vi } from 'vitest';
import { AppError } from '../src/shared/errors.js';
import { IncomesService } from '../src/modules/incomes/incomes.service.js';
import type { IncomesRepository } from '../src/modules/incomes/incomes.repository.js';

const income = {
  id: '10000000-0000-4000-8000-000000000001',
  amountCents: 250000,
  date: new Date('2026-10-01T12:00:00.000Z'),
  category: 'Salario',
  note: null,
  currency: 'USD',
  createdAt: new Date('2026-10-01T12:00:00.000Z'),
  updatedAt: new Date('2026-10-01T12:00:00.000Z'),
};

describe('ingresos personales', () => {
  it('lista y crea solo dentro de la identidad recibida', async () => {
    const repository = {
      list: vi.fn(async () => [income]),
      create: vi.fn(async () => income),
      find: vi.fn(async () => income),
      update: vi.fn(async () => ({ count: 1 })),
      remove: vi.fn(async () => ({ count: 1 })),
    };
    const service = new IncomesService(repository as unknown as IncomesRepository);
    const userId = '20000000-0000-4000-8000-000000000001';
    const rows = await service.list(userId, { currency: 'USD', limit: 100 });
    expect(rows).toEqual([income]);
    expect(repository.list).toHaveBeenCalledWith(userId, {
      from: undefined,
      to: undefined,
      currency: 'USD',
      limit: 100,
    });
    await service.create(userId, {
      amountCents: 250000,
      date: '2026-10-01T12:00:00.000Z',
      category: 'Salario',
      currency: 'USD',
    });
    expect(repository.create).toHaveBeenCalledWith(userId, expect.anything());
  });

  it('no permite actualizar ni borrar un ingreso ajeno', async () => {
    const repository = {
      list: vi.fn(),
      create: vi.fn(),
      find: vi.fn(),
      update: vi.fn(async () => ({ count: 0 })),
      remove: vi.fn(async () => ({ count: 0 })),
    };
    const service = new IncomesService(repository as unknown as IncomesRepository);
    await expect(
      service.update(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        { note: 'otro' },
      ),
    ).rejects.toEqual(new AppError(404, 'INCOME_NOT_FOUND', 'Ingreso no encontrado'));
    await expect(
      service.remove(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
      ),
    ).rejects.toEqual(new AppError(404, 'INCOME_NOT_FOUND', 'Ingreso no encontrado'));
  });
});
