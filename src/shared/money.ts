import { AppError } from './errors.js';

/** Máximo de PostgreSQL INTEGER usado por los campos Prisma Int. */
export const MAX_MONEY_CENTS = 2_147_483_647;

/** Valida que un monto sea un entero positivo representable de forma segura. */
export function assertPositiveCents(value: number, field = 'amountCents'): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_MONEY_CENTS) {
    throw new AppError(422, 'INVALID_MONEY', `${field} debe ser un entero positivo en centavos`);
  }
}

/** Suma centavos con detección de desbordamiento. */
export function sumCents(values: readonly number[]): number {
  const total = values.reduce((sum, value) => sum + value, 0);
  if (!Number.isSafeInteger(total)) {
    throw new AppError(422, 'MONEY_OVERFLOW', 'La suma monetaria excede el rango seguro');
  }
  return total;
}

/** Reparte centavos de forma exacta y determinista según el orden recibido. */
export function splitEqual(totalCents: number, participantCount: number): number[] {
  assertPositiveCents(totalCents, 'totalCents');
  if (!Number.isSafeInteger(participantCount) || participantCount <= 0) {
    throw new AppError(422, 'INVALID_PARTICIPANTS', 'Debe existir al menos un participante');
  }
  const base = Math.floor(totalCents / participantCount);
  const remainder = totalCents % participantCount;
  return Array.from({ length: participantCount }, (_, index) => base + (index < remainder ? 1 : 0));
}

/** Verifica igualdad exacta entre un total y sus partes enteras. */
export function assertExactTotal(totalCents: number, parts: readonly number[], code: string): void {
  parts.forEach((part) => assertPositiveCents(part));
  if (sumCents(parts) !== totalCents) {
    throw new AppError(422, code, 'Las partes no suman exactamente el total');
  }
}

/** Comprueba el código ISO 4217 sintáctico usado por el MVP. */
export function assertCurrency(currency: string): void {
  if (!/^[A-Z]{3}$/.test(currency) || !Intl.supportedValuesOf('currency').includes(currency)) {
    throw new AppError(
      422,
      'INVALID_CURRENCY',
      'currency debe ser un codigo ISO de tres letras mayusculas',
    );
  }
}
