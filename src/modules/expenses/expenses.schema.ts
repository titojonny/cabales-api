import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

const cents = z.number().int().positive().max(MAX_MONEY_CENTS);
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const allocation = z.object({ eventParticipantId: z.string().uuid(), amountCents: cents }).strict();

/** Contrato estructural; las sumas y pertenencia se validan en el servicio. */
export const createExpenseSchema = z
  .object({
    eventId: z.string().uuid(),
    title: z.string().trim().min(1).max(160),
    notes: z.string().trim().max(1000).optional(),
    totalCents: cents,
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/),
    splitMode: z.enum(['EQUAL', 'EXACT']),
    occurredAt: dateTime,
    participants: z
      .array(
        z.object({ eventParticipantId: z.string().uuid(), shareCents: cents.optional() }).strict(),
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
  })
  .strict();

/** Gasto estructuralmente válido pendiente de comprobar sus sumas. */
export type CreateExpenseInput = z.infer<typeof createExpenseSchema>;
