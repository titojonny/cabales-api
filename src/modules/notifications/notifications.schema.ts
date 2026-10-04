import { z } from 'zod';

/** Tipos de aviso con preferencias configurables. */
export const NOTIFICATION_TYPES = [
  'invitation.received',
  'invitation.accepted',
  'settlement.created',
  'transfer.paid',
  'budget.threshold',
  'fund.movement',
  'ocr.finished',
  'privacy.updated',
  'document.expiring',
  'document.expired',
  'achievement.unlocked',
  'event.reminder',
  'recurring.expense',
  'event.comment',
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

export const listNotificationsQuerySchema = z
  .object({
    status: z.enum(['UNREAD', 'READ', 'ARCHIVED', 'ACTIVE']).default('ACTIVE'),
    cursor: z.string().uuid().optional(),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();

export const updatePreferencesSchema = z
  .object({
    preferences: z
      .array(
        z
          .object({
            type: z.enum(NOTIFICATION_TYPES),
            inApp: z.boolean(),
            email: z.boolean(),
            push: z.boolean(),
          })
          .strict(),
      )
      .min(1)
      .max(NOTIFICATION_TYPES.length),
  })
  .strict();

export const pushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((value) => value.startsWith('https://'), 'El endpoint debe usar HTTPS'),
    keys: z
      .object({
        p256dh: z
          .string()
          .min(16)
          .max(512)
          .regex(/^[A-Za-z0-9_-]+$/, 'p256dh debe estar codificada en base64url'),
        auth: z
          .string()
          .min(8)
          .max(512)
          .regex(/^[A-Za-z0-9_-]+$/, 'auth debe estar codificada en base64url'),
      })
      .strict(),
  })
  .strict();

export const deletePushSubscriptionSchema = z
  .object({
    endpoint: z
      .string()
      .url()
      .max(2048)
      .refine((value) => value.startsWith('https://'), 'El endpoint debe usar HTTPS'),
  })
  .strict();

export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
export type UpdatePreferencesInput = z.infer<typeof updatePreferencesSchema>;
export type PushSubscriptionInput = z.infer<typeof pushSubscriptionSchema>;
