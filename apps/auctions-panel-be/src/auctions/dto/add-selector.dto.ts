import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';

export const AddSelectorSchema = z.object({
  selector: z.string({ message: 'Селектор є обовʼязковим.' }),
  isBuyAction:z.boolean({message: "isBuyAction має бути boolean"}).optional()
});

export type AddSelectorDto = z.infer<typeof AddSelectorSchema>;

export class AddSelectorSwaggerDto {
  @ApiProperty({ example: '.selector', description: 'html селектор елемента' })
  selector: string;

  @ApiProperty({ required: false, default: false })
  isBuyAction?: boolean;
}
