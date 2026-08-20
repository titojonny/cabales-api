import { z } from 'zod';

// El dinero SIEMPRE viaja en centavos (entero): cero ambigüedad.
export const crearConsumoSchema = z.object({
  descripcion: z.string().min(1, 'La descripción no puede estar vacía').max(200, 'La descripción es demasiado larga').optional(),
  monto_centavos: z
    .number({ message: 'El monto es obligatorio' })
    .int('El monto debe ser un número entero de centavos')
    .positive('El monto debe ser mayor a 0'),
  participante_ids: z
    .array(z.string().uuid('ID de participante inválido'))
    .min(1, 'Debes enviar al menos un participante')
});