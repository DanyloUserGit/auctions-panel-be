import { LogSeverity, SessionEventType } from '@prisma/client';
import { z } from 'zod';

// --- CreateLogDto ---
export const CreateLogSchema = z.object({
  sessionId: z.string(),
  userId: z.string().optional(),
  eventType: z.nativeEnum(SessionEventType),
  severity: z.nativeEnum(LogSeverity).optional(),
  message: z.string(),
  details: z.record(z.string(), z.any()).optional(),
  isIncident: z.boolean().optional(),
});

export type CreateLogDto = z.infer<typeof CreateLogSchema>;

const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

// --- LogFilterDto --- (ТЗ 9: пошук, фільтри, сортування)
export const LogFilterSchema = z.object({
  sessionId: z.string().uuid().optional(),
  userId: z.string().uuid().optional(),
  auctionId: z.string().uuid().optional(),
  userGroupId: z.string().uuid().optional(),
  eventType: z.nativeEnum(SessionEventType).optional(),
  isIncident: bool.optional(),
  // Пошук: текст події, ID сесії, користувач (ім'я/email), аукціон.
  search: z.string().trim().optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  sortBy: z.enum(['time', 'tag']).default('time'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
  skip: z.coerce.number().int().nonnegative().optional(),
  take: z.coerce.number().int().positive().max(500).optional(),
});

export type LogFilterDto = z.infer<typeof LogFilterSchema>;
