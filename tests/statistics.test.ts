import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors.js';
import { buildStatisticsCsv, csvCell } from '../src/modules/statistics/statistics.service.js';
import { buildStatisticsPdf } from '../src/modules/statistics/statistics.pdf.js';

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
    ).toThrowError(
      new AppError(413, 'STATISTICS_EXPORT_TOO_LARGE', 'La exportacion excede el limite de filas'),
    );
  });

  it('genera un PDF valido sin navegador y marca la proyeccion como estimacion', () => {
    const pdf = buildStatisticsPdf({
      currency: 'USD',
      totals: { spentCents: 12500, expenseCount: 2, myShareCents: 6000, myPaidCents: 7000 },
      byCategory: [],
      byGroup: [],
      byEvent: [],
      byPerson: [],
      trend: [],
      budgets: [],
      projection: {
        month: '2026-10',
        asOf: new Date('2026-10-03T00:00:00.000Z'),
        daysElapsed: 3,
        daysRemaining: 28,
        currentMonthSpentCents: 12500,
        dailyRateCents: 4167,
        recurrentPendingCents: 1000,
        recurrentPending: [],
        remainingProjectionCents: 117676,
        projectedMonthTotalCents: 130176,
        methodology: 'Estimacion, no dato real',
      },
    });
    expect(pdf.subarray(0, 8).toString('ascii')).toContain('%PDF-1.4');
    expect(pdf.toString('binary')).toContain('xref');
    // Los paréntesis del texto se escapan dentro de una cadena PDF válida.
    expect(pdf.toString('binary')).toContain('Proyeccion \\(estimacion, no dato real\\)');
  });
});
