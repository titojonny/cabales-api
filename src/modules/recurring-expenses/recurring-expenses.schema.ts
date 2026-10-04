import { z } from 'zod';
import { MAX_MONEY_CENTS } from '../../shared/money.js';

const cents = z.number().int().positive().max(MAX_MONEY_CENTS);
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const common = {
  title: z.string().trim().min(1).max(160),
  notes: z.string().trim().max(1000).optional(),
  amountCents: cents,
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .regex(/^[A-Z]{3}$/),
  categoryId: z.string().uuid().optional(),
  tagIds: z.array(z.string().uuid()).max(10).default([]),
  frequency: z.enum(['WEEKLY', 'MONTHLY', 'YEARLY']),
  chargeDay: z.number().int().min(1).max(31),
  nextRunAt: dateTime,
  endsAt: dateTime.nullable().optional(),
};

type RecurringDateFields = {
  endsAt?: Date | null | undefined;
  nextRunAt: Date;
  frequency: 'WEEKLY' | 'MONTHLY' | 'YEARLY';
  chargeDay: number;
};

const validateDates = <T extends z.ZodTypeAny>(schema: T) =>
  schema.superRefine((value, context) => {
    const fields = value as RecurringDateFields;
    if (fields.endsAt && fields.endsAt <= fields.nextRunAt) {
      context.addIssue({
        code: 'custom',
        path: ['endsAt'],
        message: 'endsAt debe ser posterior a nextRunAt',
      });
    }
    if (fields.frequency === 'WEEKLY' && fields.chargeDay > 7) {
      context.addIssue({
        code: 'custom',
        path: ['chargeDay'],
        message: 'La semana usa un dia entre 1 y 7',
      });
    }
  });

export const createPersonalRecurringSchema = validateDates(z.object(common).strict());

const recurringParticipant = z
  .object({
    eventParticipantId: z.string().uuid(),
    shareCents: cents,
    payerAmountCents: z.number().int().positive().max(MAX_MONEY_CENTS).optional(),
  })
  .strict();

export const createGroupRecurringSchema = validateDates(
  z
    .object({
      ...common,
      eventId: z.string().uuid(),
      participants: z.array(recurringParticipant).min(1).max(200),
    })
    .strict()
    .superRefine((value, context) => {
      if (
        new Set(value.participants.map((item) => item.eventParticipantId)).size !==
        value.participants.length
      ) {
        context.addIssue({
          code: 'custom',
          path: ['participants'],
          message: 'Hay participantes duplicados',
        });
      }
      if (
        value.participants.reduce((sum, item) => sum + item.shareCents, 0) !== value.amountCents
      ) {
        context.addIssue({
          code: 'custom',
          path: ['participants'],
          message: 'Las partes no suman el importe',
        });
      }
      if (
        value.participants.reduce((sum, item) => sum + (item.payerAmountCents ?? 0), 0) !==
        value.amountCents
      ) {
        context.addIssue({
          code: 'custom',
          path: ['participants'],
          message: 'Los pagos no suman el importe',
        });
      }
    }),
);

export const updateRecurringSchema = z
  .object({
    title: common.title.optional(),
    notes: common.notes.nullable().optional(),
    amountCents: common.amountCents.optional(),
    frequency: common.frequency.optional(),
    chargeDay: common.chargeDay.optional(),
    categoryId: common.categoryId.nullable().optional(),
    tagIds: common.tagIds.optional(),
    nextRunAt: common.nextRunAt.optional(),
    endsAt: common.endsAt,
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debes enviar al menos un campo');

export type CreatePersonalRecurringInput = z.infer<typeof createPersonalRecurringSchema>;
export type CreateGroupRecurringInput = z.infer<typeof createGroupRecurringSchema>;
export type UpdateRecurringInput = z.infer<typeof updateRecurringSchema>;
