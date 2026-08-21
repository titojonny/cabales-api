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

/** Contrato de evento con miembros, invitados y enlaces acotados. */
export const createEventSchema = z
  .object({
    name: z.string().trim().min(2).max(160),
    description: z.string().trim().max(1000).optional(),
    startsAt: dateTime,
    memberIds: z.array(z.string().uuid()).max(100).default([]),
    guests: z.array(z.string().trim().min(1).max(120)).max(100).default([]),
    links: z
      .array(z.object({ label: z.string().trim().min(1).max(80), url: httpUrl }).strict())
      .max(20)
      .default([]),
  })
  .strict();

/** Evento validado antes de aplicar pertenencia de negocio. */
export type CreateEventInput = z.infer<typeof createEventSchema>;
