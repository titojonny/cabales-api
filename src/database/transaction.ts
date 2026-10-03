import { Prisma } from '@prisma/client';

/** Indica si PostgreSQL canceló una transacción por serialización o conflicto de escritura. */
export function isSerializationConflict(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034';
}

/**
 * Repite una operación serializable como máximo tres veces.
 * No reintenta errores funcionales ni permite ciclos infinitos.
 */
export async function withSerializableRetry<T>(
  operation: () => Promise<T>,
  maxAttempts = 3,
): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      if (!isSerializationConflict(error) || attempt === maxAttempts) throw error;
    }
  }
  throw lastError;
}
