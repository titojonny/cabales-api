import { AppError } from './errors.js';
import { MAX_MONEY_CENTS, assertPositiveCents, sumCents } from './money.js';

export const BASIS_POINTS_TOTAL = 10_000;

function assertNonNegativeCents(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > MAX_MONEY_CENTS) {
    throw new AppError(422, 'INVALID_MONEY', `${field} debe ser un entero no negativo en centavos`);
  }
}

function distributeRemainder(
  totalCents: number,
  weights: readonly number[],
  weightTotal: number,
  errorCode: string,
): number[] {
  assertNonNegativeCents(totalCents, 'totalCents');
  if (weights.length === 0) {
    throw new AppError(422, 'INVALID_PARTICIPANTS', 'Debe existir al menos un participante');
  }
  if (!Number.isSafeInteger(weightTotal) || weightTotal <= 0) {
    throw new AppError(422, errorCode, 'Los pesos deben sumar un valor positivo');
  }
  weights.forEach((weight) => {
    if (!Number.isSafeInteger(weight) || weight < 0) {
      throw new AppError(422, errorCode, 'Los pesos deben ser enteros no negativos');
    }
  });

  const floors = weights.map((weight) => Math.floor((totalCents * weight) / weightTotal));
  const remainders = weights.map((weight) => (totalCents * weight) % weightTotal);
  const remaining = totalCents - sumCents(floors);
  const order = remainders
    .map((remainder, index) => ({ remainder, index }))
    .sort((left, right) => right.remainder - left.remainder || left.index - right.index);
  for (let index = 0; index < remaining; index += 1) {
    floors[order[index % order.length]!.index]! += 1;
  }
  return floors;
}

/** Reparte un subtotal usando porcentajes expresados en puntos básicos. */
export function splitByBasisPoints(
  subtotalCents: number,
  percentagesBps: readonly number[],
): number[] {
  assertPositiveCents(subtotalCents, 'subtotalCents');
  if (sumCents(percentagesBps) !== BASIS_POINTS_TOTAL) {
    throw new AppError(
      422,
      'PERCENTAGES_MISMATCH',
      'Los porcentajes deben sumar exactamente 10000 puntos básicos',
    );
  }
  return distributeRemainder(
    subtotalCents,
    percentagesBps,
    BASIS_POINTS_TOTAL,
    'INVALID_PERCENTAGE',
  );
}

/** Distribuye un cargo por el peso real del subtotal de cada participante. */
export function splitProportionally(
  chargeCents: number,
  subtotalShares: readonly number[],
): number[] {
  assertNonNegativeCents(chargeCents, 'chargeCents');
  const subtotal = sumCents(subtotalShares);
  if (subtotal <= 0) {
    throw new AppError(422, 'INVALID_SUBTOTAL', 'El subtotal debe ser positivo');
  }
  return distributeRemainder(chargeCents, subtotalShares, subtotal, 'INVALID_SUBTOTAL');
}

/** Redondeo monetario documentado: mitad hacia arriba al centavo más cercano. */
export function roundBasisPointCharge(subtotalCents: number, percentageBps: number): number {
  assertPositiveCents(subtotalCents, 'subtotalCents');
  if (
    !Number.isSafeInteger(percentageBps) ||
    percentageBps < 0 ||
    percentageBps > BASIS_POINTS_TOTAL
  ) {
    throw new AppError(
      422,
      'INVALID_PERCENTAGE',
      'El porcentaje debe estar entre 0 y 10000 puntos básicos',
    );
  }
  return Math.floor((subtotalCents * percentageBps + BASIS_POINTS_TOTAL / 2) / BASIS_POINTS_TOTAL);
}
