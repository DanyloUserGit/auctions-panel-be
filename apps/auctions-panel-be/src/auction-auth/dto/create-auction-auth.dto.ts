import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateAuctionAuthSchema = z.object({
  title: z.string({
    message: 'Назва акаунта має бути валідною.',
  }),
  email: z.string({
    message: 'Акаунт має бути валідним.',
  }),

  password: z.string().min(6, { message: 'Пароль має містити мінімум 6 символів.' }),

  auctionId: z.string().uuid({
    message: 'auctionId має бути валідним UUID.',
  }),
});

export type CreateAuctionAuthDto = z.infer<typeof CreateAuctionAuthSchema>;

export class CreateAuctionAuthSwaggerDto {
  @ApiProperty({
    example: 'account name',
    description: 'title для акаунту аукціону',
  })
  title: string;

  @ApiProperty({
    example: 'user@example.com',
    description: 'Email для входу в аукціон',
  })
  email: string;

  @ApiProperty({
    example: 'securePassword123',
    description: 'Пароль доступу до аукціону',
  })
  password: string;

  @ApiProperty({
    example: 'uuid-auction-id',
    description: 'ID аукціону',
  })
  auctionId: string;
}
