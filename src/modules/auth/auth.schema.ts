import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(12).max(128);
const token = z
  .string()
  .min(32)
  .max(256)
  .regex(/^[A-Za-z0-9_-]+$/);

/** Contrato canónico de registro. */
export const registerSchema = z
  .object({
    email,
    password,
    displayName: z.string().trim().min(2).max(120),
  })
  .strict();

/** Contrato canónico de inicio de sesión. */
export const loginSchema = z.object({ email, password }).strict();

export const emailTokenSchema = z.object({ token }).strict();

export const emailSchema = z.object({ email }).strict();

export const passwordResetSchema = z.object({ token, password }).strict();

/** Rectificación de datos de perfil hecha por el propio titular. */
export const updateProfileSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120).optional(),
    locale: z.enum(['es', 'en']).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

const googleCallbackState = z.string().regex(/^[A-Za-z0-9_-]{32,256}$/);
export const googleCallbackQuerySchema = z.union([
  z.object({ code: z.string().min(1).max(4096), state: googleCallbackState }).strict(),
  z
    .object({
      error: z.string().min(1).max(100),
      error_description: z.string().max(512).optional(),
      state: googleCallbackState,
    })
    .strict(),
]);

export type EmailInput = z.infer<typeof emailSchema>;
export type PasswordResetInput = z.infer<typeof passwordResetSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;

/** Registro validado y normalizado. */
export type RegisterInput = z.infer<typeof registerSchema>;
/** Credenciales validadas y normalizadas. */
export type LoginInput = z.infer<typeof loginSchema>;
