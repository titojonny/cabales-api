import { z } from 'zod';

export const createPersonalCategorySchema = z
  .object({
    name: z.string().trim().min(1).max(80),
    color: z
      .string()
      .regex(/^#[0-9a-fA-F]{6}$/)
      .optional(),
  })
  .strict();

export const updatePersonalCategorySchema = createPersonalCategorySchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debes enviar al menos un campo');

export type CreatePersonalCategoryInput = z.infer<typeof createPersonalCategorySchema>;
export type UpdatePersonalCategoryInput = z.infer<typeof updatePersonalCategorySchema>;
