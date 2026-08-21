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

/** Token opaco requerido para aceptar una invitación. */
export const acceptInvitationSchema = z.object({ token: z.string().min(20).max(200) }).strict();

/** Grupo nuevo validado. */
export type CreateGroupInput = z.infer<typeof createGroupSchema>;
/** Cambio parcial de grupo validado. */
export type UpdateGroupInput = z.infer<typeof updateGroupSchema>;
/** Invitación validada y sin rol propietario. */
export type InviteInput = z.infer<typeof inviteSchema>;
