import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const AddUserSchema = z.object({
  userId: z.string().uuid({ message: 'Id користувача є обовʼязковою.' }),
});

export type AddUserDto = z.infer<typeof AddUserSchema>;

export class AddUserSwaggerDto {
  @ApiProperty({ example: 'user uuid', description: 'id користувача' })
  userId: string;
}
