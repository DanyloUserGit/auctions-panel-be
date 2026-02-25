import { z } from 'zod';
import { CreateAuctionAuthSchema } from './create-auction-auth.dto';

export const UpdateAuctionAuthSchema = CreateAuctionAuthSchema.partial();

export type UpdateAuctionAuthDto = z.infer<typeof UpdateAuctionAuthSchema>;
