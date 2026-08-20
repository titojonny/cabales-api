import { describe, expect, it } from 'vitest';
import { centavosADolares, dolaresACentavos, repartirCentavosSobrantes } from '../src/utils/money.js';

describe('dolaresACentavos', () => {
  it('convierte sin errores de precisión de punto flotante', () => {
    expect(dolaresACentavos(0.1) + dolaresACentavos(0.2)).toBe(30);
  });

  it('redondea correctamente a 2 decimales', () => {
    expect(dolaresACentavos(33.333)).toBe(3333);
  });
});

describe('centavosADolares', () => {
  it('convierte centavos a dólares', () => {
    expect(centavosADolares(2500)).toBe(25);
  });
});

describe('repartirCentavosSobrantes', () => {
  it('100 entre 3 reparte el centavo sobrante', () => {
    const partes = repartirCentavosSobrantes([33.33, 33.33, 33.33], 100);
    expect(partes).toEqual([3334, 3333, 3333]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(10000);
  });

  it('50 entre 3 quita el centavo de más', () => {
    const partes = repartirCentavosSobrantes([16.67, 16.67, 16.67], 50);
    expect(partes).toEqual([1666, 1667, 1667]);
    expect(partes.reduce((a, b) => a + b, 0)).toBe(5000);
  });

  it('con total exacto no toca las partes', () => {
    const partes = repartirCentavosSobrantes([2.5, 2.5, 2.5, 2.5], 10);
    expect(partes).toEqual([250, 250, 250, 250]);
  });

  it('la suma siempre cuadra con el total', () => {
    const totales = [10.01, 99.99, 123.45, 0.03, 7.77];
    for (const total of totales) {
      const partes = repartirCentavosSobrantes([total / 3, total / 3, total / 3], total);
      expect(partes.reduce((a, b) => a + b, 0)).toBe(dolaresACentavos(total));
    }
  });

  it('lista vacía devuelve lista vacía', () => {
    expect(repartirCentavosSobrantes([], 100)).toEqual([]);
  });
});