import { describe, expect, it } from 'vitest';
import { calcularBalances, flujoMinimoEfectivo } from '../src/utils/settlement.js';

describe('calcularBalances', () => {
  it('clasifica deudores y acreedores y ordena DESC', () => {
    const { deudores, acreedores } = calcularBalances([
      { id: 'a', monto_consumido_centavos: 8000, monto_pagado_centavos: 0 },
      { id: 'b', monto_consumido_centavos: 2000, monto_pagado_centavos: 10000 },
      { id: 'c', monto_consumido_centavos: 3000, monto_pagado_centavos: 3000 }
    ]);
    expect(deudores).toEqual([{ id: 'a', debe: 8000 }]);
    expect(acreedores).toEqual([{ id: 'b', leDeben: 8000 }]);
  });

  it('todos en cero no genera deudores ni acreedores', () => {
    const { deudores, acreedores } = calcularBalances([
      { id: 'a', monto_consumido_centavos: 1000, monto_pagado_centavos: 1000 }
    ]);
    expect(deudores).toHaveLength(0);
    expect(acreedores).toHaveLength(0);
  });
});

describe('flujoMinimoEfectivo', () => {
  it('caso clásico: 2 deudores y 1 acreedor → 2 transferencias', () => {
    const t = flujoMinimoEfectivo(
      [
        { id: 'a', debe: 5000 },
        { id: 'c', debe: 5000 }
      ],
      [{ id: 'b', leDeben: 10000 }]
    );
    expect(t).toHaveLength(2);
    expect(t.reduce((s, x) => s + x.monto_centavos, 0)).toBe(10000);
  });

  it('1 deudor y 2 acreedores → 2 transferencias', () => {
    const t = flujoMinimoEfectivo(
      [{ id: 'a', debe: 10000 }],
      [
        { id: 'b', leDeben: 6000 },
        { id: 'c', leDeben: 4000 }
      ]
    );
    expect(t).toHaveLength(2);
    expect(t.reduce((s, x) => s + x.monto_centavos, 0)).toBe(10000);
  });

  it('centavo sobrante: suma cuadra exacta', () => {
    const t = flujoMinimoEfectivo(
      [
        { id: 'a', debe: 3334 },
        { id: 'b', debe: 3333 },
        { id: 'c', debe: 3333 }
      ],
      [{ id: 'd', leDeben: 10000 }]
    );
    expect(t.reduce((s, x) => s + x.monto_centavos, 0)).toBe(10000);
    expect(t).toHaveLength(3);
  });

  it('listas vacías → 0 transferencias', () => {
    expect(flujoMinimoEfectivo([], [])).toEqual([]);
  });

  it('máximo n-1 transferencias', () => {
    const t = flujoMinimoEfectivo(
      [
        { id: 'a', debe: 1000 },
        { id: 'b', debe: 2000 },
        { id: 'c', debe: 3000 }
      ],
      [{ id: 'd', leDeben: 6000 }]
    );
    expect(t.length).toBeLessThanOrEqual(3);
  });
});