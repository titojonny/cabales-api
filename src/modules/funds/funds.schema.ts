import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

export const createFundSchema = z
  .object({
    name: z.string().trim().min(2).max(120),
    description: z.string().trim().max(500).optional(),
    memberIds: z.array(z.string().uuid()).max(100).default([]),
  })
  .strict();

export const updateFundSchema = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    description: z.string().trim().max(500).nullable().optional(),
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

export const createContributionRequestSchema = z
  .object({
    dueAt: z.string().datetime({ offset: true }),
    members: z
      .array(
        z
          .object({
            fundMemberId: z.string().uuid(),
            amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
          })
          .strict(),
      )
      .min(1)
      .max(100),
  })
  .strict();

export const contributionRequestsQuerySchema = z
  .object({
    status: z.enum(['PENDING', 'PAID', 'OVERDUE', 'ALL']).default('ALL'),
    limit: z.coerce.number().int().min(1).max(100).default(100),
  })
  .strict();

/** Movimiento inmutable. ADJUSTMENT admite signo y exige descripción. */
export const createMovementSchema = z.discriminatedUnion('type', [
  z
    .object({
      type: z.literal('CONTRIBUTION'),
      amountCents: z.number().int().positive().max(MAX_MONEY_CENTS),
      description: z.string().trim().max(500).optional(),
      contributionRequestMemberId: z.string().uuid().optional(),
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
export type CreateContributionRequestInput = z.infer<typeof createContributionRequestSchema>;
export type ContributionRequestsQuery = z.infer<typeof contributionRequestsQuerySchema>;
