import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateUserSchema = z.object({
  firstName: z.string().min(2, { message: "Ім'я має бути стрічкою, 2 символи та більше." }),
  lastName: z.string().min(2, { message: 'Прізвище має бути стрічкою, 2 символи та більше.' }),
  email: z.string().email({ message: 'Неправильний тип пошти.' }),
  password: z.string().min(8, { message: 'Пароль має містити мінімум 8 символів.' }),
  role: z.enum(['SuperAdmin', 'Admin', 'User'], {
    message: 'Потрібно обрати 1 з наступних ролей: SuperAdmin, Admin, User.',
  }),
  rights: z.enum(['Read', 'Write', 'All'], {
    message: 'Потрібно обрати права зі списку: Read, Write, ReadAndWrite, Buy, Sell, BuyAndSell.',
  }),
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export class CreateUserSwaggerDto {
  @ApiProperty({ example: 'John', description: "Ім'я користувача" })
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Прізвище користувача' })
  lastName: string;

  @ApiProperty({ example: 'john.doe@example.com', description: 'Email користувача' })
  email: string;

  @ApiProperty({ example: 'strongPassword123', description: 'Пароль користувача' })
  password: string;

  @ApiProperty({
    example: 'User',
    enum: ['SuperAdmin', 'Admin', 'User'],
    description: 'Роль користувача',
  })
  role: 'SuperAdmin' | 'Admin' | 'User';

  @ApiProperty({
    example: 'Read',
    enum: ['Read', 'Write', 'ReadAndWrite', 'Buy', 'Sell', 'BuyAndSell'],
    description: 'Права користувача',
  })
  rights: 'Read' | 'Write' | 'ReadAndWrite' | 'Buy' | 'Sell' | 'BuyAndSell';
}
