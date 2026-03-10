import { z } from 'zod';

export const SessionFilterSchema = z.object({
  isActive: z.boolean().optional(),
  userId: z.string().optional(),
  auctionId: z.string().optional(),
  auctionGroupId: z.string().optional(),
  
  startDate: z.string().datetime().optional(), 
  endDate: z.string().datetime().optional(),
  
  skip: z.number().int().nonnegative().optional(), 
  take: z.number().int().positive().optional(),   
});

export type SessionFilterDto = z.infer<typeof SessionFilterSchema>;