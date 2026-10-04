import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

const cents = z.number().int().positive().max(MAX_MONEY_CENTS);
const nonNegativeCents = z.number().int().nonnegative().max(MAX_MONEY_CENTS);
const basisPoints = z.number().int().nonnegative().max(10_000);
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const allocation = z.object({ eventParticipantId: z.string().uuid(), amountCents: cents }).strict();

/** Contrato estructural; las sumas y pertenencia se validan en el servicio. */
export const createExpenseSchema = z
  .object({
    eventId: z.string().uuid(),
    ocrJobId: z.string().uuid().optional(),
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(1000).optional(),
    categoryId: z.string().uuid().optional(),
    totalCents: cents,
    subtotalCents: cents.optional(),
    taxCents: nonNegativeCents.optional(),
    taxPercentBps: basisPoints.optional(),
    tipCents: nonNegativeCents.optional(),
    tipPercentBps: basisPoints.optional(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    splitMode: z.enum(['EQUAL', 'EXACT', 'PERCENT']),
    occurredAt: dateTime,
    participants: z
      .array(
        z
          .object({
            eventParticipantId: z.string().uuid(),
            shareCents: nonNegativeCents.optional(),
            percentageBps: basisPoints.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(200),
    payers: z.array(allocation).min(1).max(200),
    items: z
      .array(
        z
          .object({
            name: z.string().trim().min(1).max(160),
            amountCents: cents,
            quantity: z.number().int().positive().max(10_000).default(1),
            allocations: z.array(allocation).min(1).max(200),
          })
          .strict(),
      )
      .min(1)
      .max(500)
      .optional(),
    tagIds: z.array(z.string().uuid()).max(10).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.taxCents !== undefined && value.taxPercentBps !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['taxCents'],
        message: 'Usa importe o porcentaje para el impuesto, no ambos.',
      });
    }
    if (value.tipCents !== undefined && value.tipPercentBps !== undefined) {
      context.addIssue({
        code: 'custom',
        path: ['tipCents'],
        message: 'Usa importe o porcentaje para la propina, no ambos.',
      });
    }
  });

/** Gasto estructuralmente válido pendiente de comprobar sus sumas. */
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;

export const createPersonalExpenseSchema = z
  .object({
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(1000).optional(),
    categoryId: z.string().uuid().optional(),
    tagIds: z.array(z.string().uuid()).max(10).optional(),
    totalCents: cents,
    currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/),
    occurredAt: dateTime,
  })
  .strict();

export const updatePersonalExpenseSchema = createPersonalExpenseSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debes enviar al menos un campo');

export const expenseHistoryQuerySchema = z
  .object({
    month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    categoryId: z.string().uuid().optional(),
    tagId: z.string().uuid().optional(),
    groupId: z.string().uuid().optional(),
    text: z.string().trim().max(120).optional(),
    scope: z.enum(['ALL', 'PERSONAL', 'GROUPS']).default('ALL'),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export type CreatePersonalExpenseInput = z.infer<typeof createPersonalExpenseSchema>;
export type UpdatePersonalExpenseInput = z.infer<typeof updatePersonalExpenseSchema>;
export type ExpenseHistoryQuery = z.infer<typeof expenseHistoryQuerySchema>;

export const groupExpenseQuerySchema = z
  .object({
    from: z.string().datetime({ offset: true }).optional(),
    to: z.string().datetime({ offset: true }).optional(),
    categoryId: z.string().uuid().optional(),
    tagId: z.string().uuid().optional(),
    text: z.string().trim().max(120).optional(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.from && value.to && new Date(value.from) >= new Date(value.to)) {
      context.addIssue({ code: 'custom', path: ['to'], message: 'to debe ser posterior a from' });
    }
  });

export type GroupExpenseQuery = z.infer<typeof groupExpenseQuerySchema>;
