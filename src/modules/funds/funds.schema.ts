import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

export const createFundSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
    contributionPolicy: z.enum(['ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS']).default('ANY_MEMBER'),
    withdrawalPolicy: z.enum(['ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS']).default('MANAGERS'),
    closingPolicy: z.enum(['ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS']).default('MANAGERS'),
    withdrawalLimitCents: z.number().int().positive().max(MAX_MONEY_CENTS).nullable().optional(),
  })
  .strict();

export const updateFundSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
    contributionPolicy: z.enum(['ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS']).optional(),
    withdrawalPolicy: z.enum(['ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS']).optional(),
    closingPolicy: z.enum(['ANY_MEMBER', 'MANAGERS', 'GROUP_ADMINS']).optional(),
    withdrawalLimitCents: z.number().int().positive().max(MAX_MONEY_CENTS).nullable().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debe enviar al menos un cambio');

export const addFundMemberSchema = z
  .object({
    groupMemberId: z.string().uuid(),
    role: z.enum(['MANAGER', 'MEMBER']).default('MEMBER'),
  })
  .strict();

export const updateFundMemberSchema = z.object({ role: z.enum(['MANAGER', 'MEMBER']) }).strict();

/** Movimiento inmutable. ADJUSTMENT admite signo y exige descripción. */
export const createMovementSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('CONTRIBUTION'),
      amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
      description: z.string().trim().max(500).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal('WITHDRAWAL'),
      amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
      description: z.string().trim().min(3).max(500),
    })
    .strict(),
  z
    .object({
      type: z.literal('ADJUSTMENT'),
      amountCents: z
        .number()
        .int()
        .min(-MAX_MONEY_CENTS)
        .max(MAX_MONEY_CENTS)
        .refine((value) => value !== 0, 'El ajuste no puede ser cero'),
      description: z.string().trim().min(3).max(500),
    })
    .strict(),
]);

export const movementsQuerySchema = z
  .object({
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(50),
  })
  .strict();

export type CreateFundInput = z.infer<typeof createFundSchema>;
export type UpdateFundInput = z.infer<typeof updateFundSchema>;
export type CreateMovementInput = z.infer<typeof createMovementSchema>;
