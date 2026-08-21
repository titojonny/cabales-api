import type { Response } from 'express';

/** Emite el sobre exitoso estable del contrato v1. */
export function sendData(
  res: Response,
  data: unknown,
  status = 200,
  meta?: Record<string, unknown>,
): void {
  res.status(status).json({ success: true, data, ...(meta ? { meta } : {}) });
}
