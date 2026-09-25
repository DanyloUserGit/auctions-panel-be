import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateAuctionSchema = z.object({
  title: z.string().min(1, { message: 'Назва є обовʼязковою.' }),
  url: z.url().min(3, { message: 'Посилання на аукціон є обовʼязковим.' }),


  // Проксі: http(s)://user:pass@host:port або socks5://host:port; порожній рядок - прибрати проксі.
  proxyUrl: z
    .string()
    .trim()
    .refine((v) => v === '' || /^(https?|socks5):\/\/[^\s/]+(:\d+)?\/?$/.test(v), {
      message: 'Проксі: http(s)://логін:пароль@хост:порт або socks5://хост:порт',
    })
    .optional(),

  sessions: z.array(z.string().uuid({ message: 'SessionId має бути валідним UUID.' })).optional(),
  auctionGroupId: z
    .string()
    .uuid({ message: 'auctionGroupId має бути валідним UUID.' })
    .or(z.literal('')) 
    .transform((val) => (val === '' ? undefined : val)) 
    .optional(),

  auctionAuths: z
    .array(z.string().uuid({ message: 'AuctionAuthId має бути валідним UUID.' }))
    .optional(),

});

export type CreateAuctionDto = z.infer<typeof CreateAuctionSchema>;

export class CreateAuctionSwaggerDto {
  @ApiProperty({ example: 'Test auction', description: 'Назва аукціону' })
  title: string;

  @ApiProperty({ example: 'https://ee.bca-europe.com/', description: 'Сайт аукціону' })
  url: string;

  @ApiProperty({
    example: ['uuid-session-1'],
    required: false,
    description: 'Масив ID сесій',
  })
  sessions?: string[];

  @ApiProperty({
    example: ['uuid-auth-1'],
    required: false,
    description: 'Масив ID AuctionAuth (optional у DTO)',
  })
  auctionAuths?: string[];

  @ApiProperty({
    example: 'uuid-group-id',
    required: false,
    description: 'ID групи аукціонів',
  })
  auctionGroupId?: string;
}
