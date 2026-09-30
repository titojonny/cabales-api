import { describe, expect, it } from 'vitest';
import { addMonthsUtc, periodWindow, recentWindows } from '../src/shared/periods.js';

const d = (value: string) => new Date(value);

describe('periodos de presupuesto', () => {
  it('recorta fin de mes al sumar meses', () => {
    expect(addMonthsUtc(d('2026-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2026-02-28T00:00:00.000Z',
    );
    expect(addMonthsUtc(d('2024-01-31T00:00:00Z'), 1).toISOString()).toBe(
      '2024-02-29T00:00:00.000Z',
    );
  });

  it('calcula la ventana mensual anclada al inicio', () => {
    const window = periodWindow(
      { period: 'MONTHLY', startsAt: d('2026-01-15T00:00:00Z'), endsAt: null },
      d('2026-03-20T10:00:00Z'),
    );
    expect(window).toMatchObject({ state: 'ACTIVE' });
    expect(window.start.toISOString()).toBe('2026-03-15T00:00:00.000Z');
    expect(window.end.toISOString()).toBe('2026-04-15T00:00:00.000Z');
  });

  it('calcula semanas y límites exactos', () => {
    const budget = { period: 'WEEKLY' as const, startsAt: d('2026-09-07T00:00:00Z'), endsAt: null };
    expect(periodWindow(budget, d('2026-09-14T00:00:00Z')).start.toISOString()).toBe(
      '2026-09-14T00:00:00.000Z',
    );
    expect(periodWindow(budget, d('2026-09-13T23:59:59Z')).start.toISOString()).toBe(
      '2026-09-07T00:00:00.000Z',
    );
  });

  it('marca periodos futuros y terminados', () => {
    const budget = {
      period: 'YEARLY' as const,
      startsAt: d('2026-01-01T00:00:00Z'),
      endsAt: d('2027-06-01T00:00:00Z'),
    };
    expect(periodWindow(budget, d('2025-12-31T00:00:00Z')).state).toBe('UPCOMING');
    const ended = periodWindow(budget, d('2028-01-01T00:00:00Z'));
    expect(ended.state).toBe('ENDED');
    expect(ended.end.toISOString()).toBe('2027-06-01T00:00:00.000Z');
  });

  it('usa el rango completo en CUSTOM y lista historial', () => {
    const custom = {
      period: 'CUSTOM' as const,
      startsAt: d('2026-09-01T00:00:00Z'),
      endsAt: d('2026-09-10T00:00:00Z'),
    };
    expect(periodWindow(custom, d('2026-09-05T00:00:00Z')).state).toBe('ACTIVE');
    const monthly = {
      period: 'MONTHLY' as const,
      startsAt: d('2026-01-01T00:00:00Z'),
      endsAt: null,
    };
    const history = recentWindows(monthly, d('2026-04-10T00:00:00Z'), 6);
    expect(history).toHaveLength(4);
    expect(history[0]!.start.toISOString()).toBe('2026-01-01T00:00:00.000Z');
  });
});
