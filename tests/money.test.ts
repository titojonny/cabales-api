import { describe, expect, it } from 'vitest';
import { AppError } from '../src/shared/errors.js';
import {
  assertCurrency,
  assertExactTotal,
  MAX_MONEY_CENTS,
  splitEqual,
  sumCents,
} from '../src/shared/money.js';

describe('splitEqual', () => {
  it('reparte centavos sobrantes de forma exacta y determinista', () => {
    expect(splitEqual(10_000, 3)).toEqual([3334, 3333, 3333]);
    expect(sumCents(splitEqual(10_000, 3))).toBe(10_000);
  });

  it('rechaza montos no enteros y participantes vacios', () => {
    expect(() => splitEqual(10.5, 2)).toThrow(AppError);
    expect(() => splitEqual(100, 0)).toThrow(AppError);
  });

  it('respeta el rango INTEGER de PostgreSQL y monedas ISO', () => {
    expect(() => splitEqual(MAX_MONEY_CENTS + 1, 2)).toThrow(AppError);
    expect(() => assertCurrency('USD')).not.toThrow();
    expect(() => assertCurrency('ZZZ')).toThrowError(
      expect.objectContaining({ code: 'INVALID_CURRENCY' }),
    );
  });
});

describe('assertExactTotal', () => {
  it('acepta solo partes positivas que cuadran', () => {
    expect(() => assertExactTotal(100, [40, 60], 'MISMATCH')).not.toThrow();
    expect(() => assertExactTotal(100, [40, 59], 'MISMATCH')).toThrowError(
      expect.objectContaining({ code: 'MISMATCH' }),
    );
    expect(() => assertExactTotal(100, [100, 0], 'MISMATCH')).toThrowError(
      expect.objectContaining({ code: 'INVALID_MONEY' }),
    );
  });
});
