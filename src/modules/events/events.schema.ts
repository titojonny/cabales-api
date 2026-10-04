import { z } from 'zod';

const httpUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    try {
      return ['http:', 'https:'].includes(new URL(value).protocol);
    } catch {
      return false;
    }
  }, 'La URL debe usar HTTP o HTTPS');
const dateTime = z
  .string()
  .datetime({ offset: true })
  .transform((value) => new Date(value));
const optionalText = (max: number) => z.string().trim().max(max).nullable().optional();
const mapsUrl = z
  .string()
  .url()
  .max(2048)
  .refine((value) => value.startsWith('https://'), 'Maps debe usar HTTPS')
  .nullable()
  .optional();
const linksSchema = z
  .array(z.object({ label: z.string().trim().min(1).max(80), url: httpUrl }).strict())
  .max(20);
const eventScheduleFields = {
  endsAt: dateTime.optional(),
  locationName: optionalText(160),
  locationAddress: optionalText(500),
  mapsUrl,
  timeZone: z.string().trim().min(1).max(80).nullable().optional(),
};

/** Contrato de evento con miembros, invitados y enlaces acotados. */
export const createEventSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000).optional(),
    startsAt: dateTime,
    ...eventScheduleFields,
    memberIds: z.array(z.string().uuid()).max(100).default([]),
    guests: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    links: linksSchema.default([]),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endsAt && value.endsAt < value.startsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'La fecha de fin debe ser posterior o igual al inicio',
      });
    }
  });

/** Evento validado antes de aplicar pertenencia de negocio. */
export type CreateEventInput = z.infer<typeof createEventSchema>;

/** Campos editables; null limpia un valor opcional y links reemplaza la colección completa. */
export const updateEventSchema = z
  .object({
    name: z.string().trim().min(2).max(160).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    startsAt: dateTime.optional(),
    endsAt: dateTime.nullable().optional(),
    locationName: optionalText(160),
    locationAddress: optionalText(500),
    mapsUrl,
    timeZone: z.string().trim().min(1).max(80).nullable().optional(),
    links: linksSchema.optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'Debes indicar al menos un campo')
  .superRefine((value, context) => {
    if (value.startsAt && value.endsAt && value.endsAt < value.startsAt) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['endsAt'],
        message: 'La fecha de fin debe ser posterior o igual al inicio',
      });
    }
  });

export type UpdateEventInput = z.infer<typeof updateEventSchema>;

export const rsvpSchema = z
  .object({ status: z.enum(['PENDING', 'GOING', 'MAYBE', 'DECLINED']) })
  .strict();
export type RsvpInput = z.infer<typeof rsvpSchema>;

export const eventRemindersSchema = z
  .object({
    reminders: z
      .array(
        z
          .object({
            minutesBefore: z.number().int().min(1).max(525600),
            enabled: z.boolean().default(true),
          })
          .strict(),
      )
      .max(5)
      .refine(
        (items) => new Set(items.map((item) => item.minutesBefore)).size === items.length,
        'No repitas el intervalo de un recordatorio',
      ),
  })
  .strict();
export type EventRemindersInput = z.infer<typeof eventRemindersSchema>;
