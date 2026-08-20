import { z } from 'zod';

// Un solo pago por request (MVP): el frontend dispara Promise.all si pagan dos.
// Sin campo descripcion — sería Data Discarding sin columna donde persistirlo.
export const registrarPagoSchema = z.object({
  participante_id: z.string({ message: 'El participante_id es obligatorio' }).uuid('El participante_id debe ser un UUID válido'),
  monto_centavos: z
    .number({ message: 'El monto es obligatorio' })
    .int('El monto debe ser un número entero de centavos')
    .positive('El monto debe ser mayor a 0')
});