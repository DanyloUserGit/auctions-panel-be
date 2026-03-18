import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const AddPathSchema = z.object({
  path: z.string().url({ message: 'Посилання є обовʼязковим.' }),
});

export type AddPathDto = z.infer<typeof AddPathSchema>;

export class AddPathSwaggerDto {
  @ApiProperty({ example: 'path (url)', description: 'url правила' })
  path: string;
}
