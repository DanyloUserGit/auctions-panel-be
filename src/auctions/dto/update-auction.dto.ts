import { z } from 'zod';
import { CreateAuctionSchema } from './create-auction.dto';

export const UpdateAuctionSchema = CreateAuctionSchema.partial();

export type UpdateAuctionDto = z.infer<typeof UpdateAuctionSchema>;
