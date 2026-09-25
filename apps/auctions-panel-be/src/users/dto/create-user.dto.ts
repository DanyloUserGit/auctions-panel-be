import { ApiProperty } from '@nestjs/swagger';
import { AccessStatus } from '@prisma/client';
import { z } from 'zod';

// Адмін-поля картки контролю (ТЗ 11): змінюють лише SuperAdmin і GA своєї групи.
export const ADMIN_FIELDS_SHAPE = {
  hasContract: z.boolean().optional(),
  contractNumber: z.string().trim().max(100).nullish(),
  depositAmount: z.number().nonnegative().nullish(),
  depositMethod: z.string().trim().max(200).nullish(),
  adminComment: z.string().max(5000).nullish(),
  adminExtra: z.string().max(5000).nullish(),
};
export const ADMIN_FIELDS = Object.keys(ADMIN_FIELDS_SHAPE) as (keyof typeof ADMIN_FIELDS_SHAPE)[];

export const CreateUserSchema = z.object({
  firstName: z.string().min(2, { message: "Ім'я має бути стрічкою, 2 символи та більше." }),
  lastName: z.string().min(2, { message: 'Прізвище має бути стрічкою, 2 символи та більше.' }),
  middleName: z.string().trim().max(100).optional(),
  email: z.string().email({ message: 'Неправильний тип пошти.' }),
  password: z.string().min(8, { message: 'Пароль має містити мінімум 8 символів.' }),
  phone: z.string().optional(),
  city: z.string().optional(),
  role: z.enum(['SuperAdmin', 'Admin', 'User'], {
    message: 'Потрібно обрати 1 з наступних ролей: SuperAdmin, Admin, User.',
  }),
  // Статус доступу можна обрати вже при створенні (ТЗ 11, 12; [?1]); за замовчуванням - «Тільки перегляд».
  accessStatus: z.nativeEnum(AccessStatus).default(AccessStatus.ReadOnly),
  // Причина статусу (необов'язкова при створенні) - записується в журнал.
  statusReason: z.string().trim().max(500).optional(),
  userGroupId: z.string().uuid().optional(),
  // Особистий ліміт одночасних сесій; 0 - без особистого ліміту.
  sessionLimit: z.number().int().min(0).default(0),
  managedGroup: z.string().uuid().optional(),
  ...ADMIN_FIELDS_SHAPE,
});

export type CreateUserDto = z.infer<typeof CreateUserSchema>;

export class CreateUserSwaggerDto {
  @ApiProperty({ example: 'John' })
  firstName!: string;

  @ApiProperty({ example: 'Doe' })
  lastName!: string;

  @ApiProperty({ example: 'john.doe@example.com' })
  email!: string;

  @ApiProperty({ example: 'password123' })
  password!: string;

  @ApiProperty({ example: '+380990000000', required: false })
  phone?: string;

  @ApiProperty({ example: 'Kyiv', required: false })
  city?: string;

  @ApiProperty({ enum: ['SuperAdmin', 'Admin', 'User'] })
  role!: 'SuperAdmin' | 'Admin' | 'User';

  @ApiProperty({ enum: AccessStatus, default: AccessStatus.ReadOnly })
  accessStatus!: AccessStatus;

  @ApiProperty({ example: 'uuid-string', required: false, nullable: true })
  userGroupId?: string;

  @ApiProperty({ example: 1, default: 1 })
  sessionLimit!: number;
}