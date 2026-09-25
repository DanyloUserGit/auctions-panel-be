import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { AccessStatus } from '@prisma/client';
import { z } from 'zod';

// Зміна статусу доступу / блокування (ТЗ 12): лише ці поля і обов'язкова причина, яка йде в журнал.
export const UpdateUserStatusSchema = z
  .object({
    accessStatus: z.nativeEnum(AccessStatus).optional(),
    isBlocked: z.boolean().optional(),
    isActive: z.boolean().optional(),
    reason: z.string().trim().min(3, { message: 'Вкажіть причину зміни статусу (щонайменше 3 символи)' }).max(500),
  })
  .refine((d) => d.accessStatus !== undefined || d.isBlocked !== undefined || d.isActive !== undefined, {
    message: 'Не вказано, що змінити',
  });

export type UpdateUserStatusDto = z.infer<typeof UpdateUserStatusSchema>;

export class UpdateUserStatusSwaggerDto {
  @ApiPropertyOptional({ enum: AccessStatus })
  accessStatus?: AccessStatus;

  @ApiPropertyOptional()
  isBlocked?: boolean;

  @ApiPropertyOptional()
  isActive?: boolean;

  @ApiProperty({ example: 'Підписано договір, внесено депозит' })
  reason!: string;
}
