import { Prisma } from '@prisma/client';
import { describe, expect, it, vi } from 'vitest';
import { withSerializableRetry } from '../src/database/transaction.js';
import { isIdempotencyActive } from '../src/shared/idempotency.js';

function serializationConflict() {
  return new Prisma.PrismaClientKnownRequestError('conflicto serializable', {
    code: 'P2034',
    clientVersion: '7.9.1',
  });
}

describe('withSerializableRetry', () => {
  it('reintenta P2034 de forma acotada hasta recuperar la operación', async () => {
    const operation = vi
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(serializationConflict())
      .mockRejectedValueOnce(serializationConflict())
      .mockResolvedValue('ok');
    await expect(withSerializableRetry(operation)).resolves.toBe('ok');
    expect(operation).toHaveBeenCalledTimes(3);
  });

  it('no supera tres intentos ni reintenta errores funcionales', async () => {
    const conflict = vi.fn<() => Promise<void>>().mockRejectedValue(serializationConflict());
    await expect(withSerializableRetry(conflict)).rejects.toMatchObject({ code: 'P2034' });
    expect(conflict).toHaveBeenCalledTimes(3);

    const functional = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('funcional'));
    await expect(withSerializableRetry(functional)).rejects.toThrow('funcional');
    expect(functional).toHaveBeenCalledTimes(1);
  });
});

describe('isIdempotencyActive', () => {
  it('permite reclamar una llave vencida y conserva una vigente', () => {
    const now = new Date('2026-08-21T12:00:00.000Z');
    expect(isIdempotencyActive(new Date('2026-08-21T11:59:59.999Z'), now)).toBe(false);
    expect(isIdempotencyActive(new Date('2026-08-21T12:00:00.001Z'), now)).toBe(true);
  });
});
