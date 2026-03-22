import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const LoginSchema = z.object({
  email: z.string().email({ message: 'Неправильний тип пошти.' }),
  password: z.string().min(8, { message: 'Пароль має містити мінімум 8 символів.' }),
  token: z.string()
});

export type LoginDto = z.infer<typeof LoginSchema>;

export class LoginSwaggerDto {
  @ApiProperty({ example: 'john.doe@example.com', description: 'Email користувача' })
  email: string;

  @ApiProperty({ example: 'strongPassword123', description: 'Пароль користувача' })
  password: string;

  @ApiProperty({ example: 'token', description: 'token капчі' })
  token: string;
}
export class LoginSwaggerResDto {
  @ApiProperty({ example: '...', description: 'access_token' })
  access_token: string;

  @ApiProperty({ example: '...', description: 'refresh_token' })
  refresh_token: string;
}
