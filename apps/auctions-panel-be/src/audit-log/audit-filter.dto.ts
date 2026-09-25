import { AuditCategory } from '@prisma/client';
import { z } from 'zod';

export const AuditFilterSchema = z.object({
  category: z.nativeEnum(AuditCategory).optional(),
  userId: z.string().uuid().optional(),
  action: z.string().trim().optional(),
  search: z.string().trim().optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
  take: z.coerce.number().int().positive().max(500).optional(),
});

export type AuditFilterDto = z.infer<typeof AuditFilterSchema>;
