import { createHash, randomBytes } from 'node:crypto';

/** Genera un token opaco con 256 bits de entropía. */
export function randomToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Produce el digest persistible de un token que nunca debe guardarse en claro. */
export function hashToken(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/** Serializa claves de objetos de forma estable para comparar solicitudes idempotentes. */
export function stableStringify(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Huella determinista del cuerpo validado de una solicitud. */
export function requestHash(value: unknown): string {
  return hashToken(stableStringify(value));
}
