import { LogSeverity } from '@prisma/client';
import { z } from 'zod';

export const UpdateGlobalSettingsSchema = z.object({
  // Таймаут бездіяльності сесії, хвилини.
  inactivityTimeout: z.number().int().min(1).optional(),
  // Максимум одночасно запущених сесій (браузерів) у системі; 0 - без ліміту.
  globalSessionLimit: z.number().int().min(0).optional(),
  // Максимум користувачів в одній сесії; коли місця немає, запускається нова сесія (ТЗ 7.3).
  sessionMaxConnections: z.number().int().min(1).max(50).optional(),
  // Скільки днів зберігати завершені сесії з журналами; 0 - зберігати завжди.
  sessionRetentionDays: z.number().int().min(0).max(3650).optional(),
  streamFps: z.number().int().min(5).max(30).optional(),
  streamQuality: z.number().int().min(30).max(100).optional(),
  streamBitrateKbps: z.number().int().min(500).max(20000).optional(),
  gaCanAssignGa: z.boolean().optional(),
  loggingPolicy: z.nativeEnum(LogSeverity).optional(),
});

export type UpdateGlobalSettingsDto = z.infer<typeof UpdateGlobalSettingsSchema>;
