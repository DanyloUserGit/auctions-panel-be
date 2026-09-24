import { ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

// Лише ці два поля: інакше через /status можна було б змінити будь-яке поле користувача (роль тощо).
export const UpdateUserStatusSchema = z.object({
  isBlocked: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

export type UpdateUserStatusDto = z.infer<typeof UpdateUserStatusSchema>;

export class UpdateUserStatusSwaggerDto implements UpdateUserStatusDto {
  @ApiPropertyOptional()
  isBlocked?: boolean;

  @ApiPropertyOptional()
  isActive?: boolean;
}
