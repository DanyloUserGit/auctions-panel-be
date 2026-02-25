import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const AddAuctionSchema = z.object({
  auctionId: z.string().uuid({ message: 'Id аукціона є обовʼязковою.' }),
});

export type AddAuctionDto = z.infer<typeof AddAuctionSchema>;

export class AddAuctionSwaggerDto {
  @ApiProperty({ example: 'auction uuid', description: 'id аукціона' })
  auctionId: string;
}
