import { z } from 'zod';
import { CreateAuctionGroupSchema } from './create-auction-group.dto';

export const UpdateAuctionGroupSchema = CreateAuctionGroupSchema.partial();

export type UpdateAuctionGroupDto = z.infer<typeof UpdateAuctionGroupSchema>;
