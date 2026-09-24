import { z } from 'zod';
import { ApiProperty } from '@nestjs/swagger';

export const AddAccountSchema = z.object({
  accountId: z.string().uuid(),
});

export type AddAccountDto = z.infer<typeof AddAccountSchema>;

export class AddAccountSwaggerDto {
  @ApiProperty({ example: 'Uuid', description: 'Id акаунта для входу в аукціон (AuctionAuth)' })
  accountId!: string;
}
