import { z } from 'zod';

const uuid = z.string().uuid();
const category = z.enum([
  'IDENTIDAD',
  'VIAJE',
  'SEGURO',
  'VEHICULO',
  'SALUD',
  'HOGAR',
  'FINANZAS',
  'OTRO',
]);
const dateTime = z.string().datetime({ offset: true });
const booleanQuery = z.preprocess(
  (value) => (value === 'true' ? true : value === 'false' ? false : value),
  z.boolean(),
);
const expiryNoticeDays = z
  .array(z.number().int().min(1).max(365))
  .min(1)
  .max(3)
  .refine((days) => new Set(days).size === days.length, 'No repitas los avisos de vencimiento');
const expiryNoticeDaysInput = z.preprocess(
  (value) =>
    typeof value === 'string' ? value.split(',').map((part) => Number(part.trim())) : value,
  expiryNoticeDays,
);

/** Metadatos de subida enviados por query junto al cuerpo binario. */
export const uploadQuerySchema = z
  .object({
    name: z.string().trim().min(1).max(255),
    category: category.default('OTRO'),
    expiresAt: dateTime.nullable().optional(),
    expiryNoticeDays: expiryNoticeDaysInput.optional(),
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
    category: category.optional(),
    pinned: booleanQuery.optional(),
    recent: booleanQuery.optional(),
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
    category: category.optional(),
    expiresAt: dateTime.nullable().optional(),
    expiryNoticeDays: expiryNoticeDaysInput.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

export const grantSchema = z
  .object({ access: z.enum(['VIEW', 'EDIT', 'MANAGE']), expiresAt: dateTime.nullable().optional() })
  .strict();

export const sharedLinkSchema = z
  .object({
    expiresAt: dateTime,
    maxAccesses: z.number().int().min(1).max(10_000).optional(),
  })
  .strict();

export const pinSchema = z.object({}).strict();

export const documentLockPinSchema = z
  .object({ pin: z.string().regex(/^\d{6,12}$/, 'El PIN debe tener de 6 a 12 digitos') })
  .strict();

export const documentLockSettingsSchema = z
  .object({
    password: z.string().min(1).max(200),
    pin: z
      .string()
      .regex(/^\d{6,12}$/)
      .nullable()
      .optional(),
    unlockTtlMinutes: z.number().int().min(1).max(60).optional(),
  })
  .strict();

export const documentLockRemoveSchema = z.object({ password: z.string().min(1).max(200) }).strict();

const base64Url = (max: number) =>
  z
    .string()
    .min(1)
    .max(max)
    .regex(/^[A-Za-z0-9_-]+$/, 'Debe ser base64url');

const clientExtensionResultsSchema = z
  .record(z.string().min(1).max(128), z.unknown())
  .superRefine((value, context) => {
    if (Object.keys(value).length > 32)
      context.addIssue({ code: 'too_big', maximum: 32, origin: 'object', inclusive: true });
  });

const webAuthnClientDataSchema = z.object({
  clientDataJSON: base64Url(16_384),
});

export const webAuthnResponseSchema = z
  .object({
    id: z.string().min(1).max(2_048),
    rawId: base64Url(2_048),
    response: z.union([
      webAuthnClientDataSchema
        .extend({
          attestationObject: base64Url(1_048_576),
          transports: z
            .array(z.enum(['ble', 'hybrid', 'internal', 'nfc', 'usb']))
            .max(5)
            .optional(),
        })
        .strict(),
      webAuthnClientDataSchema
        .extend({
          authenticatorData: base64Url(1_048_576),
          signature: base64Url(1_048_576),
          userHandle: base64Url(2_048).nullable().optional(),
        })
        .strict(),
    ]),
    type: z.literal('public-key'),
    clientExtensionResults: clientExtensionResultsSchema.optional(),
    authenticatorAttachment: z.enum(['platform', 'cross-platform']).nullable().optional(),
  })
  .strict();
export const sharedTokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/, 'Enlace no valido');

export type UploadQuery = z.infer<typeof uploadQuerySchema>;
export type ListDocumentsQuery = z.infer<typeof listDocumentsQuerySchema>;
export type UpdateDocumentInput = z.infer<typeof updateDocumentSchema>;
export type SharedLinkInput = z.infer<typeof sharedLinkSchema>;
export type GrantInput = z.infer<typeof grantSchema>;
export type DocumentLockSettingsInput = z.infer<typeof documentLockSettingsSchema>;
