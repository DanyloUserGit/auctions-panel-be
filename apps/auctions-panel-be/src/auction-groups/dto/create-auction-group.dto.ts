import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateAuctionGroupSchema = z.object({
  title: z.string().min(1, {
    message: 'Назва є обовʼязковою.',
  }),
  users: z.array(z.string().uuid({ message: 'UserId має бути валідним UUID.' })).optional(),
  groupAdmin: z.string().uuid({
    message: 'groupAdmin має бути валідним UUID.',
  }).optional(),
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
    example: '550e8400-e29b-41d4-a716-446655440000',
    description: 'ID користувача, який є адміністратором групи',
  })
  groupAdmin: string;
    @ApiProperty({
    example: ['uuid-user-1', 'uuid-user-2'],
    required: false,
    description: 'Масив ID користувачів',
  })
  users?: string[];
  @ApiProperty({
    example: ['uuid-auction-1', 'uuid-auction-2'],
    required: false,
    description: 'Масив ID аукціонів',
  })
  auctions?: string[];
}
