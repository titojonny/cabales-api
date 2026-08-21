// Motor matemático de Cabales: cálculo de balances y flujo mínimo de efectivo.
// Todo en centavos (Int) — cero Float.

import { EstadoTransaccion } from '@prisma/client';

export interface ParticipanteBalance {
  id: string;
  balance: number; // >0 deudor, <0 acreedor, 0 liquidado
}

export interface Deudor {
  id: string;
  debe: number; // positivo
}

export interface Acreedor {
  id: string;
  leDeben: number; // positivo
}

export interface Transferencia {
  deudorId: string;
  acreedorId: string;
  monto_centavos: number;
}

// 7 días en milisegundos — usado para fecha_limite al pasar a EN_REVISION
export const SIETE_DIAS_MS = 7 * 24 * 60 * 60 * 1000;

// Tipado estricto de la matriz de transiciones permitidas
export type TransicionesPermitidas = Record<EstadoTransaccion, EstadoTransaccion[]>;

export const TRANSICIONES_PERMITIDAS: TransicionesPermitidas = {
  PENDIENTE: ['EN_REVISION', 'COMPLETADO', 'EN_DISPUTA'],
  EN_REVISION: ['COMPLETADO', 'EN_DISPUTA'],
  EN_DISPUTA: ['EN_REVISION', 'COMPLETADO'],
  COMPLETADO: [],
};

export function esTransicionPermitida(actual: EstadoTransaccion, siguiente: EstadoTransaccion): boolean {
  return TRANSICIONES_PERMITIDAS[actual]?.includes(siguiente) ?? false;
}

// balance = consumido - pagado
export function calcularBalances(
  participantes: Array<{ id: string; monto_consumido_centavos: number; monto_pagado_centavos: number }>
): { deudores: Deudor[]; acreedores: Acreedor[] } {
  const deudores: Deudor[] = [];
  const acreedores: Acreedor[] = [];

  for (const p of participantes) {
    const balance = p.monto_consumido_centavos - p.monto_pagado_centavos;
    if (balance > 0) {
      deudores.push({ id: p.id, debe: balance });
    } else if (balance < 0) {
      acreedores.push({ id: p.id, leDeben: -balance });
    }
  }

  // Orden DESC para que el greedy empareje los saldos más grandes primero
  // y minimice el número de transferencias.
  deudores.sort((a, b) => b.debe - a.debe);
  acreedores.sort((a, b) => b.leDeben - a.leDeben);

  return { deudores, acreedores };
}

// Algoritmo greedy: empareja el mayor deudor con el mayor acreedor
// hasta agotar saldos. Garantiza n-1 transferencias máximo y suma exacta.
export function flujoMinimoEfectivo(deudores: Deudor[], acreedores: Acreedor[]): Transferencia[] {
  const transferencias: Transferencia[] = [];
  let i = 0;
  let j = 0;

  // Copias mutables para no modificar los arreglos originales fuera
  const d = deudores.map((x) => ({ ...x }));
  const a = acreedores.map((x) => ({ ...x }));

  while (i < d.length && j < a.length) {
    const deudor = d[i];
    const acreedor = a[j];
    if (!deudor || !acreedor) break;

    const monto = Math.min(deudor.debe, acreedor.leDeben);

    transferencias.push({
      deudorId: deudor.id,
      acreedorId: acreedor.id,
      monto_centavos: monto
    });

    deudor.debe -= monto;
    acreedor.leDeben -= monto;

    if (deudor.debe === 0) i++;
    if (acreedor.leDeben === 0) j++;
  }

  return transferencias;
}