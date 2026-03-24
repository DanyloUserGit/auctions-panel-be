import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateUserSchema = z.object({
  firstName: z.string().min(2, { message: "Ім'я має бути стрічкою, 2 символи та більше." }),
  lastName: z.string().min(2, { message: 'Прізвище має бути стрічкою, 2 символи та більше.' }),
  email: z.string().email({ message: 'Неправильний тип пошти.' }),
  password: z.string().min(8, { message: 'Пароль має містити мінімум 8 символів.' }),
  phone: z.string().optional(),
  city: z.string().optional(), 
  role: z.enum(['SuperAdmin', 'Admin', 'User'], {
    message: 'Потрібно обрати 1 з наступних ролей: SuperAdmin, Admin, User.',
  }),
  rights: z.enum(['Read', 'Write', 'All'], {
    message: 'Потрібно обрати права зі списку: Read, Write, All.',
  }),
  auctionGroupId: z.string().uuid().optional(),
  sessionLimit: z.number().int().min(1).default(1), 
  managedGroup: z.string().uuid().optional()
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export class CreateUserSwaggerDto {
  @ApiProperty({ example: 'John' })
  firstName: string;

  @ApiProperty({ example: 'Doe' })
  lastName: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email: string;

  @ApiProperty({ example: 'password123' })
  password: string;

  @ApiProperty({ example: '+380990000000', required: false })
  phone?: string;

  @ApiProperty({ example: 'Kyiv', required: false })
  city?: string;

  @ApiProperty({ enum: ['SuperAdmin', 'Admin', 'User'] })
  role: 'SuperAdmin' | 'Admin' | 'User';

  @ApiProperty({ enum: ['Read', 'Write', 'All'] })
  rights: 'Read' | 'Write' | 'All';

  @ApiProperty({ example: 'uuid-string', required: false, nullable:true })
  auctionGroupId?: string;

  @ApiProperty({ example: 1, default: 1 })
  sessionLimit: number;
}