import { z } from 'zod';

const email = z.string().trim().toLowerCase().email().max(320);
const password = z.string().min(12).max(128);

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

/** Registro validado y normalizado. */
export type RegisterInput = z.infer<typeof registerSchema>;
/** Credenciales validadas y normalizadas. */
export type LoginInput = z.infer<typeof loginSchema>;
