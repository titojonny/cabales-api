import { z } from 'zod';

// Regla de los Usuarios Fantasma: se envía el usuario de la app
// O el nombre del invitado, nunca ambos, nunca ninguno.
export const agregarParticipanteSchema = z
  .object({
    usuario_id: z.string().uuid('El ID de usuario debe ser un UUID válido').optional(),
    nombre_invitado: z.string().min(2, 'El nombre debe tener al menos 2 letras').max(100, 'El nombre es demasiado largo').optional()
  })
  .refine((data) => data.usuario_id || data.nombre_invitado, {
    message: "Debes enviar un 'usuario_id' o un 'nombre_invitado'.",
    path: ['usuario_id']
  })
  .refine((data) => !(data.usuario_id && data.nombre_invitado), {
    message: 'No puedes enviar un usuario registrado y un invitado fantasma al mismo tiempo.',
    path: ['nombre_invitado']
  });