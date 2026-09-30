import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors.js';
import { buildStatisticsCsv, csvCell } from '../src/modules/statistics/statistics.service.js';

describe('exportación CSV de estadísticas', () => {
  it('escapa RFC 4180 y neutraliza fórmulas', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('-100')).toBe("'-100");
    expect(csvCell('nombre, con "comillas"')).toBe('"nombre, con ""comillas"""');
    const csv = buildStatisticsCsv(
      {
        currency: 'USD',
        totals: { spentCents: 1000, expenseCount: 1, myShareCents: 500, myPaidCents: 1000 },
        byCategory: [{ name: '=Categoría', totalCents: 1000, count: 1 }],
        byGroup: [],
        byEvent: [],
        byPerson: [],
        trend: [],
        budgets: [],
      },
      10,
    );
    expect(csv).toContain('USD');
    expect(csv).toContain("'=Categoría");
    expect(csv).toContain('amountCents');
  });

  it('rechaza exportaciones que superan el máximo de filas', () => {
    expect(() =>
      buildStatisticsCsv(
        {
          currency: 'USD',
          totals: { spentCents: 0, expenseCount: 0, myShareCents: 0, myPaidCents: 0 },
          byCategory: [{ name: 'A', totalCents: 1, count: 1 }],
          byGroup: [],
          byEvent: [],
          byPerson: [],
          trend: [],
          budgets: [],
        },
        2,
      ),
    ).toThrowError(new AppError(413, 'STATISTICS_EXPORT_TOO_LARGE', 'La exportacion excede el limite de filas'));
  });
});
