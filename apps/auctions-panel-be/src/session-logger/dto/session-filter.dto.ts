import { z } from 'zod';

const bool = z.preprocess((v) => (v === 'true' ? true : v === 'false' ? false : v), z.boolean());

// Фільтри «Всіх дій» (ТЗ 10): користувач, аукціон, час, статус, група (SA), пошук.
export const SessionFilterSchema = z.object({
  isActive: bool.optional(),
  status: z.enum(['active', 'ended', 'error']).optional(),
  userId: z.string().uuid().optional(),
  auctionId: z.string().uuid().optional(),
  auctionGroupId: z.string().uuid().optional(),
  userGroupId: z.string().uuid().optional(),
  search: z.string().trim().optional(),
  startDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  endDate: z.string().datetime({ offset: true }).or(z.string().date()).optional(),
  skip: z.coerce.number().int().nonnegative().optional(),
  take: z.coerce.number().int().positive().max(200).optional(),
});

export type SessionFilterDto = z.infer<typeof SessionFilterSchema>;
