import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

const currency = z.string().regex(/^[A-Z]{3}$/);
const date = z.string().datetime({ offset: true });

export const incomeQuerySchema = z
  .object({
    from: date.optional(),
    to: date.optional(),
    currency: currency.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const createIncomeSchema = z
  .object({
    amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
    date,
    category: z.string().trim().min(1).max(80),
    note: z.string().trim().max(500).nullable().optional(),
    currency,
  })
  .strict();

export const updateIncomeSchema = z
  .object({
    amountCents: z.number().int().positive().max(MAX_MONEY_CENTS).optional(),
    date: date.optional(),
    category: z.string().trim().min(1).max(80).optional(),
    note: z.string().trim().max(500).nullable().optional(),
    currency: currency.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

export type IncomeQuery = z.infer<typeof incomeQuerySchema>;
export type CreateIncomeInput = z.infer<typeof createIncomeSchema>;
export type UpdateIncomeInput = z.infer<typeof updateIncomeSchema>;
