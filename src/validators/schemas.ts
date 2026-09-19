import { z } from 'zod';

export const crearUsuarioSchema = z.object({
  nombre: z.string({ message: 'El nombre es obligatorio' }).min(1, 'El nombre no puede estar vacío').max(100, 'El nombre es demasiado largo'),
  email: z.string({ message: 'El email es obligatorio' }).email('El email no tiene un formato válido').max(254, 'El email es demasiado largo'),
});

export const crearEventoSchema = z.object({
  nombre: z.string({ message: 'El nombre es obligatorio' }).min(1, 'El nombre no puede estar vacío').max(200, 'El nombre es demasiado largo'),
  creador_id: z.string({ message: 'El creador_id es obligatorio' }).uuid('El creador_id debe ser un UUID válido'),
  auto_incluir_creador: z.boolean().optional(),
});

export const actualizarUsuarioSchema = z
  .object({
    nombre: z.string().min(1, 'El nombre no puede estar vacío').max(100, 'El nombre es demasiado largo').optional(),
    avatar_url: z.string().url('El avatar_url debe ser una URL válida').optional()
  })
  .refine((data) => data.nombre !== undefined || data.avatar_url !== undefined, {
    message: 'Debes proporcionar al menos un campo a actualizar'
  });