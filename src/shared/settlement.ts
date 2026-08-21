import { AppError } from './errors.js';
import { assertPositiveCents, sumCents } from './money.js';

/** Aportes y consumo acumulables de una identidad canónica del evento. */
export interface ParticipantBalance {
  participantId: string;
  shareCents: number;
  paidCents: number;
}

/** Transferencia mínima propuesta por el cálculo puro. */
export interface SettlementTransferPlan {
  debtorParticipantId: string;
  creditorParticipantId: string;
  amountCents: number;
}

/** Calcula un plan determinista sin mutar entradas ni depender de infraestructura. */
export function calculateSettlement(
  balances: readonly ParticipantBalance[],
): SettlementTransferPlan[] {
  const net = new Map<string, number>();
  for (const entry of balances) {
    if (!Number.isSafeInteger(entry.shareCents) || !Number.isSafeInteger(entry.paidCents)) {
      throw new AppError(422, 'INVALID_BALANCE', 'Los balances deben contener centavos enteros');
    }
    const updated = (net.get(entry.participantId) ?? 0) + entry.shareCents - entry.paidCents;
    if (!Number.isSafeInteger(updated)) {
      throw new AppError(422, 'MONEY_OVERFLOW', 'El balance excede el rango numerico seguro');
    }
    net.set(entry.participantId, updated);
  }

  const debtors = [...net.entries()]
    .filter(([, amount]) => amount > 0)
    .map(([id, amount]) => ({ id, amount }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));
  const creditors = [...net.entries()]
    .filter(([, amount]) => amount < 0)
    .map(([id, amount]) => ({ id, amount: -amount }))
    .sort((a, b) => b.amount - a.amount || a.id.localeCompare(b.id));

  if (
    sumCents(debtors.map((item) => item.amount)) !== sumCents(creditors.map((item) => item.amount))
  ) {
    throw new AppError(422, 'UNBALANCED_SETTLEMENT', 'Los balances del evento no cuadran');
  }

  const result: SettlementTransferPlan[] = [];
  let debtorIndex = 0;
  let creditorIndex = 0;
  while (debtorIndex < debtors.length && creditorIndex < creditors.length) {
    const debtor = debtors[debtorIndex];
    const creditor = creditors[creditorIndex];
    if (!debtor || !creditor) break;
    const amountCents = Math.min(debtor.amount, creditor.amount);
    assertPositiveCents(amountCents);
    result.push({
      debtorParticipantId: debtor.id,
      creditorParticipantId: creditor.id,
      amountCents,
    });
    debtor.amount -= amountCents;
    creditor.amount -= amountCents;
    if (debtor.amount === 0) debtorIndex += 1;
    if (creditor.amount === 0) creditorIndex += 1;
  }
  return result;
}
