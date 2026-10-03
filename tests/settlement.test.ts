import { describe, expect, it } from 'vitest';
import { calculateSettlement } from '../src/shared/settlement.js';

describe('calculateSettlement', () => {
  it('consolida multiples gastos y conserva centavos exactos', () => {
    const transfers = calculateSettlement([
      { participantId: 'a', shareCents: 3334, paidCents: 10_000 },
      { participantId: 'b', shareCents: 3333, paidCents: 0 },
      { participantId: 'c', shareCents: 3333, paidCents: 0 },
    ]);
    expect(transfers).toEqual([
      { debtorParticipantId: 'b', creditorParticipantId: 'a', amountCents: 3333 },
      { debtorParticipantId: 'c', creditorParticipantId: 'a', amountCents: 3333 },
    ]);
  });

  it('desempata por identificador para ser determinista', () => {
    const balances = [
      { participantId: 'b', shareCents: 100, paidCents: 0 },
      { participantId: 'a', shareCents: 100, paidCents: 0 },
      { participantId: 'd', shareCents: 0, paidCents: 100 },
      { participantId: 'c', shareCents: 0, paidCents: 100 },
    ];
    expect(calculateSettlement(balances)).toEqual(calculateSettlement([...balances].reverse()));
  });

  it('rechaza balances cuya suma no cuadra', () => {
    expect(() =>
      calculateSettlement([
        { participantId: 'a', shareCents: 100, paidCents: 0 },
        { participantId: 'b', shareCents: 0, paidCents: 99 },
      ]),
    ).toThrowError(expect.objectContaining({ code: 'UNBALANCED_SETTLEMENT' }));
  });

  it('no genera transferencias cuando todos estan equilibrados', () => {
    expect(calculateSettlement([{ participantId: 'a', shareCents: 100, paidCents: 100 }])).toEqual(
      [],
    );
  });
});
