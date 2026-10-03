import { z } from 'zod';

export const createOcrJobSchema = z.object({ documentId: z.string().uuid() }).strict();
export const confirmOcrJobSchema = z.object({ expenseId: z.string().uuid() }).strict();
export const listOcrJobsQuerySchema = z
  .object({ documentId: z.string().uuid().optional() })
  .strict();
