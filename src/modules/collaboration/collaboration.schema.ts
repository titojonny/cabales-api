import { z } from 'zod';

const uuid = z.string().uuid();
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

export const createShareLinkSchema = z
  .object({
    eventId: uuid.optional(),
    settlementId: uuid.optional(),
    expiresInDays: z.number().int().min(1).max(30).default(30),
  })
  .strict()
  .superRefine((value, context) => {
    if (Boolean(value.eventId) === Boolean(value.settlementId)) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['eventId'],
        message: 'Indica exactamente un evento o una liquidacion',
      });
    }
  });

export const commentSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1)
      .max(2000)
      .refine((value) => !/[<>]/.test(value), 'Los comentarios son texto plano sin HTML'),
  })
  .strict();

export const eventFundsSchema = z
  .object({ fundIds: z.array(uuid).max(50) })
  .strict()
  .superRefine((value, context) => {
    if (new Set(value.fundIds).size !== value.fundIds.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['fundIds'],
        message: 'No repitas fondos',
      });
    }
  });

export const calendarQuerySchema = z
  .object({ from: dateTime, to: dateTime })
  .strict()
  .superRefine((value, context) => {
    const span = value.to.getTime() - value.from.getTime();
    if (span <= 0 || span > 93 * 24 * 60 * 60 * 1000) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['to'],
        message: 'El rango debe ser de 1 a 93 dias',
      });
    }
  });

export type CreateShareLinkInput = z.infer<typeof createShareLinkSchema>;
export type CommentInput = z.infer<typeof commentSchema>;
export type EventFundsInput = z.infer<typeof eventFundsSchema>;
export type CalendarQuery = z.infer<typeof calendarQuerySchema>;
