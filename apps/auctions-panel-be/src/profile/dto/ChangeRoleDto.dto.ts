import { ApiProperty } from '@nestjs/swagger';
import z from 'zod';

// Зміна ролі (лише SuperAdmin). Статус доступу змінюється окремо - PATCH /users/:id/status з причиною.
export const ChangeRoleSchema = z.object({
  id: z.uuid({ message: 'Id має бути типом uuid' }),
  role: z.enum(['SuperAdmin', 'Admin', 'User'], {
    message: 'Потрібно обрати 1 з наступних ролей: SuperAdmin, Admin, User.',
  }),
});
export type ChangeRoleDto = z.infer<typeof ChangeRoleSchema>;
export class ChangeRoleSwaggerDto {
  @ApiProperty({ example: 'uuid', description: 'Id користувача' })
  id: string;

  @ApiProperty({
    example: 'User',
    enum: ['SuperAdmin', 'Admin', 'User'],
    description: 'Роль користувача',
  })
  role: 'SuperAdmin' | 'Admin' | 'User';
}
