/** Periodicidad de presupuestos. */
export type Period = 'WEEKLY' | 'MONTHLY' | 'YEARLY' | 'CUSTOM';

/** Ventana semiabierta [start, end) y su relación con el instante consultado. */
export interface PeriodWindow {
  start: Date;
  end: Date;
  state: 'UPCOMING' | 'ACTIVE' | 'ENDED';
}

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

/** Suma meses en UTC recortando al último día válido (31 ene + 1 mes = 28/29 feb). */
export function addMonthsUtc(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const targetYear = year + Math.floor(month / 12);
  const targetMonth = ((month % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      targetMonth,
      Math.min(date.getUTCDate(), lastDay),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

function nth(period: Exclude<Period, 'CUSTOM'>, startsAt: Date, index: number): Date {
  if (period === 'WEEKLY') return new Date(startsAt.getTime() + index * WEEK_MS);
  return addMonthsUtc(startsAt, (period === 'MONTHLY' ? 1 : 12) * index);
}

/**
 * Calcula el periodo del presupuesto que contiene `at`, anclado en startsAt.
 * Antes del inicio devuelve el primer periodo (UPCOMING); después de endsAt, el último (ENDED).
 */
export function periodWindow(
  budget: { period: Period; startsAt: Date; endsAt: Date | null },
  at: Date,
): PeriodWindow {
  const { period, startsAt, endsAt } = budget;
  if (period === 'CUSTOM') {
    const end = endsAt ?? new Date(8.64e15);
    const state = at < startsAt ? 'UPCOMING' : at >= end ? 'ENDED' : 'ACTIVE';
    return { start: startsAt, end, state };
  }
  const clamp = (window: { start: Date; end: Date }) =>
    endsAt && window.end > endsAt ? { ...window, end: endsAt } : window;
  if (at < startsAt)
    return { ...clamp({ start: startsAt, end: nth(period, startsAt, 1) }), state: 'UPCOMING' };
  const reference = endsAt && at >= endsAt ? new Date(endsAt.getTime() - 1) : at;
  let index =
    period === 'WEEKLY'
      ? Math.floor((reference.getTime() - startsAt.getTime()) / WEEK_MS)
      : Math.max(
          0,
          Math.floor(
            ((reference.getUTCFullYear() - startsAt.getUTCFullYear()) * 12 +
              reference.getUTCMonth() -
              startsAt.getUTCMonth()) /
              (period === 'MONTHLY' ? 1 : 12),
          ) - 1,
        );
  while (nth(period, startsAt, index + 1) <= reference) index += 1;
  while (index > 0 && nth(period, startsAt, index) > reference) index -= 1;
  const window = clamp({
    start: nth(period, startsAt, index),
    end: nth(period, startsAt, index + 1),
  });
  return { ...window, state: endsAt && at >= endsAt ? 'ENDED' : 'ACTIVE' };
}

/** Periodos anteriores (incluido el actual) para gráficas de historial. */
export function recentWindows(
  budget: { period: Period; startsAt: Date; endsAt: Date | null },
  at: Date,
  count: number,
): Array<{ start: Date; end: Date }> {
  const windows: Array<{ start: Date; end: Date }> = [];
  let cursor = periodWindow(budget, at);
  for (let i = 0; i < count; i += 1) {
    windows.unshift({ start: cursor.start, end: cursor.end });
    if (budget.period === 'CUSTOM' || cursor.start <= budget.startsAt) break;
    cursor = periodWindow(budget, new Date(cursor.start.getTime() - 1));
  }
  return windows;
}
