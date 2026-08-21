import { z } from 'zod';

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

// Matriz de transiciones permitidas — COMPLETADO es terminal
export const TRANSICIONES_PERMITIDAS: Record<string, string[]> = {
  PENDIENTE: ['EN_REVISION', 'COMPLETADO', 'EN_DISPUTA'],
  EN_REVISION: ['COMPLETADO', 'EN_DISPUTA'],
  EN_DISPUTA: ['EN_REVISION', 'COMPLETADO'],
  COMPLETADO: []
};

export function esTransicionPermitida(actual: string, siguiente: string): boolean {
  return TRANSICIONES_PERMITIDAS[actual]?.includes(siguiente) ?? false;
}