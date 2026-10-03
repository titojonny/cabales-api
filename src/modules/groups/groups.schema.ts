import { z } from 'zod';

const currency = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/);

/** Entrada canónica para crear un grupo. */
export const createGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    currency: currency.default('USD'),
  })
  .strict();

/** Cambios parciales permitidos sobre un grupo. */
export const updateGroupSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    currency: currency.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

/** Invitación limitada a roles no propietarios. */
export const inviteSchema = z
  .object({
    email: z.string().trim().toLowerCase().email().max(320),
    role: z.enum(['ADMIN', 'MEMBER']).default('MEMBER'),
  })
  .strict();

/** Token opaco requerido para aceptar o previsualizar una invitación. */
export const acceptInvitationSchema = z
  .object({
    token: z
      .string()
      .min(20)
      .max(200)
      .regex(/^[A-Za-z0-9_-]+$/),
  })
  .strict();

/** Filtro del listado administrativo de invitaciones. */
export const invitationListQuerySchema = z
  .object({ status: z.enum(['PENDING', 'ACCEPTED', 'REVOKED', 'EXPIRED']).optional() })
  .strict();

/** Categoría propia del grupo usada por presupuestos y estadísticas. */
export const createCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

/** Grupo nuevo validado. */
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
/** Cambio parcial de grupo validado. */
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
/** Invitación validada y sin rol propietario. */
export type InviteInput = z.infer<typeof inviteSchema>;
export type CreateCategoryInput = z.infer<typeof createCategorySchema>;
