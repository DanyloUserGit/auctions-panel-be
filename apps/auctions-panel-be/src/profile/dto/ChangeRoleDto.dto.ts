import { ApiProperty } from '@nestjs/swagger';
import z from 'zod';

export const ChangeRoleSchema = z.object({
  id: z.uuid({ message: 'Id має бути типом uuid' }),
  role: z.enum(['SuperAdmin', 'Admin', 'User'], {
    message: 'Потрібно обрати 1 з наступних ролей: SuperAdmin, Admin, User.',
  }),
  rights: z.enum(['Read', 'Write', 'All'], {
    message: 'Потрібно обрати права зі списку: Read, Write, ReadAndWrite, Buy, Sell, BuyAndSell.',
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

  @ApiProperty({
    example: 'Read',
    enum: ['Read', 'Write', 'ReadAndWrite', 'Buy', 'Sell', 'BuyAndSell'],
    description: 'Права користувача',
  })
  rights: 'Read' | 'Write' | 'ReadAndWrite' | 'Buy' | 'Sell' | 'BuyAndSell';
}
