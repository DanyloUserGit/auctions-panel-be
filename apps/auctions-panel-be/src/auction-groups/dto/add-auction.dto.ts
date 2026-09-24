import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const AddAuctionSchema = z.object({
  auctionId: z.string().uuid(),
});

export type AddAuctionDto = z.infer<typeof AddAuctionSchema>;

export class AddAuctionSwaggerDto implements AddAuctionDto {
  @ApiProperty({ example: 'Uuid' })
  auctionId!: string;
}