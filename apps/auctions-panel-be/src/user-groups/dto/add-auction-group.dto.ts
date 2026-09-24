import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const AddAuctionGroupSchema = z.object({
  auctionGroupId: z.string().uuid(),
});

export type AddAuctionGroupDto = z.infer<typeof AddAuctionGroupSchema>;

export class AddAuctionGroupSwaggerDto {
  @ApiProperty({ example: 'Uuid', description: 'Id групи аукціонів (AuctionGroup)' })
  auctionGroupId!: string;
}
