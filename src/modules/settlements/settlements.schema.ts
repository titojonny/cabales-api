import { z } from 'zod';

/** Identifica el evento que se cerrará exactamente una vez. */
export const createSettlementSchema = z.object({ eventId: z.string().uuid() }).strict();
/** Solicitud validada de cierre de evento. */
export type CreateSettlementInput = z.infer<typeof createSettlementSchema>;
