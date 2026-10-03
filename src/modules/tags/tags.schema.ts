import { z } from 'zod';

export const createTagSchema = z.object({ name: z.string().trim().min(1).max(50) }).strict();

export const updateTagSchema = createTagSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debes enviar al menos un campo');

export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
