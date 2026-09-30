import { z } from 'zod';

const uuid = z.string().uuid();

/** Metadatos de subida enviados por query junto al cuerpo binario. */
export const uploadQuerySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    groupId: uuid.optional(),
    eventId: uuid.optional(),
    expenseId: uuid.optional(),
    settlementId: uuid.optional(),
  })
  .strict();

export const listDocumentsQuerySchema = z
  .object({
    groupId: uuid.optional(),
    eventId: uuid.optional(),
    expenseId: uuid.optional(),
    settlementId: uuid.optional(),
    cursor: uuid.optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

/** Cambios de nombre o asociaciones; null desasocia. */
export const updateDocumentSchema = z
  .object({
    name: z.string().trim().min(1).max(255).optional(),
    eventId: uuid.nullable().optional(),
    expenseId: uuid.nullable().optional(),
    settlementId: uuid.nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

export const grantSchema = z.object({ access: z.enum(['VIEW', 'EDIT', 'MANAGE']) }).strict();

export type UploadQuery = z.infer<typeof uploadQuerySchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
