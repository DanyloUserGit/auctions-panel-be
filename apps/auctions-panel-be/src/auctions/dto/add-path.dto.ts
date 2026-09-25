import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

// Правило переходу (ТЗ 8): повна адреса (https://site.com/orders/), шлях (/orders/) або шаблон з * (*orders*).
export const AddPathSchema = z.object({
  path: z
    .string()
    .trim()
    .min(2, { message: 'Вкажіть адресу, шлях або шаблон (мінімум 2 символи).' })
    .max(500)
    .refine((p) => p !== '/' && p.replace(/\*/g, '').trim().length > 0, {
      message: 'Правило «/» або «*» заборонило б увесь сайт.',
    }),
});

export type AddPathDto = z.infer<typeof AddPathSchema>;

export class AddPathSwaggerDto {
  @ApiProperty({ example: '/en-es/_orders/', description: 'Повна адреса, шлях або шаблон з *' })
  path: string;
}
