import { ApiProperty } from '@nestjs/swagger';
import z from 'zod';

export const EditProfileSchema = z.object({
  id: z.uuid({ message: 'Id має бути типом uuid' }),
  firstName: z.string().min(2, { message: "Ім'я має бути стрічкою, 2 символи та більше." }),
  lastName: z.string().min(2, { message: 'Прізвище має бути стрічкою, 2 символи та більше.' }),
  phone: z.string().min(10, { message: 'Номер має містити 10 символів' }),
  email: z.email({ message: "email має бути унікальним в системі та формату example@example.com" })
});
export type EditProfileDto = z.infer<typeof EditProfileSchema>;
export class EditProfileSwaggerDto {
  @ApiProperty({ example: 'uuid', description: 'Id користувача' })
  id: string;

  @ApiProperty({ example: 'John', description: "Ім'я користувача" })
  firstName: string;

  @ApiProperty({ example: 'Doe', description: 'Прізвище користувача' })
  lastName: string;

  @ApiProperty({ example: '0xxxxxxxxx', description: 'phone користувача' })
  phone: string;

  @ApiProperty({ example: 'example@example.com', description: 'email користувача' })
  email: string;
}
