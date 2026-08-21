import { z } from 'zod';
import { TRANSICIONES_PERMITIDAS, type TransicionesPermitidas } from '../utils/settlement.js';
import type { EstadoTransaccion } from '@prisma/client';

// PATCH /api/transactions/:id/status — solo exige comprobante si va a EN_REVISION
// PENDIENTE -> COMPLETADO directo permitido (efectivo / confirmación del acreedor).
export const actualizarEstadoTransaccionSchema = z
  .object({
    estado: z.enum(['PENDIENTE', 'EN_REVISION', 'EN_DISPUTA', 'COMPLETADO'], {
      message: 'El estado debe ser PENDIENTE, EN_REVISION, EN_DISPUTA o COMPLETADO'
    }),
    comprobante_url: z.string().url('El comprobante debe ser una URL válida').optional()
  })
  .refine((data) => data.estado !== 'EN_REVISION' || !!data.comprobante_url, {
    message: 'EN_REVISION requiere comprobante_url',
    path: ['comprobante_url']
  });

// Re-exportamos desde settlement para mantener una sola fuente de verdad
export { TRANSICIONES_PERMITIDAS, type TransicionesPermitidas } from '../utils/settlement.js';

export function esTransicionPermitida(actual: string, siguiente: string): boolean {
  const permitidas = TRANSICIONES_PERMITIDAS[actual as EstadoTransaccion];
  return permitidas?.includes(siguiente as EstadoTransaccion) ?? false;
}