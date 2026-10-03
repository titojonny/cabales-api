/** Determina si una respuesta idempotente todavía puede reproducirse. */
export function isIdempotencyActive(expiresAt: Date, now: Date): boolean {
  return expiresAt.getTime() > now.getTime();
}
