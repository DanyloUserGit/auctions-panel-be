import { z } from 'zod';
import { SessionEventType, LogSeverity } from '@prisma/client';

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

// --- LogFilterDto ---
export const LogFilterSchema = z.object({
  sessionId: z.string().optional(),
  userId: z.string().optional(), // Додано поле для фільтрації по юзеру
  eventType: z.nativeEnum(SessionEventType).optional(),
  isIncident: z.boolean().optional(),
  search: z.string().optional(),
  auctionGroupId: z.string().optional(),

  startDate: z.string().datetime().optional(), // Додано початкову дату
  endDate: z.string().datetime().optional(),   // Додано кінцеву дату

  skip: z.number().int().nonnegative().optional(),
  take: z.number().int().positive().optional(),
});

export type LogFilterDto = z.infer<typeof LogFilterSchema>;