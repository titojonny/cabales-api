import { z } from 'zod';

/** Solicitud de derechos ARCO-POL creada por el propio titular. */
export const createPrivacyRequestSchema = z
  .object({
    type: z.enum(['ACCESS', 'RECTIFICATION', 'ERASURE', 'OBJECTION', 'PORTABILITY']),
    reason: z.string().trim().max(1000).optional(),
  })
  .strict();

/** Confirmación; la supresión exige reautenticación con la contraseña actual. */
export const confirmPrivacyRequestSchema = z
  .object({ password: z.string().min(1).max(128).optional() })
  .strict();

export type CreatePrivacyRequestInput = z.infer<typeof createPrivacyRequestSchema>;
export type ConfirmPrivacyRequestInput = z.infer<typeof confirmPrivacyRequestSchema>;
