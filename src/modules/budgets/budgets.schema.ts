import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));

const base = {
  name: z.string().trim().min(2).max(120),
  amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
  period: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY', 'CUSTOM']),
  startsAt: dateTime,
  endsAt: dateTime.nullable().optional(),
  categoryId: z.string().uuid().nullable().optional(),
  alertThresholdPercent: z.number().int().min(1).max(100).default(80),
};

export const createBudgetSchema = z
  .object(base)
  .strict()
  .refine((value) => value.period !== 'CUSTOM' || Boolean(value.endsAt), {
    message: 'CUSTOM requiere endsAt',
    path: ['endsAt'],
  })
  .refine((value) => !value.endsAt || value.endsAt > value.startsAt, {
    message: 'endsAt debe ser posterior a startsAt',
    path: ['endsAt'],
  });

export const updateBudgetSchema = z
  .object({
    name: base.name.optional(),
    amountCents: base.amountCents.optional(),
    endsAt: base.endsAt,
    categoryId: base.categoryId,
    alertThresholdPercent: z.number().int().min(1).max(100).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

export const budgetQuerySchema = z
  .object({ at: z.string().datetime({ offset: true }).optional() })
  .strict();

export type CreateBudgetInput = z.infer<typeof createBudgetSchema>;
export type UpdateBudgetInput = z.infer<typeof updateBudgetSchema>;
