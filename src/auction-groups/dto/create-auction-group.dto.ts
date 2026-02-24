import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateAuctionGroupSchema = z.object({
  title: z.string().min(1, {
    message: 'Назва є обовʼязковою.',
  }),

  auctions: z
    .array(
      z.string().uuid({
        message: 'AuctionId має бути валідним UUID.',
      })
    )
    .optional(),
});

export type CreateAuctionGroupDto = z.infer<typeof CreateAuctionGroupSchema>;

export class CreateAuctionGroupSwaggerDto {
  @ApiProperty({
    example: 'VIP Auctions',
    description: 'Назва групи аукціонів',
  })
  title: string;

  @ApiProperty({
    example: ['uuid-auction-1', 'uuid-auction-2'],
    required: false,
    description: 'Масив ID аукціонів',
  })
  auctions?: string[];
}
