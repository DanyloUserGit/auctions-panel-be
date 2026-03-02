import { ApiProperty } from "@nestjs/swagger";
import z from "zod";

export const EditProfileSchema = z.object({
    id: z.uuid({ message: "Id має бути типом uuid" }),
    firstName: z.string().min(2, { message: "Ім'я має бути стрічкою, 2 символи та більше." }),
    lastName: z.string().min(2, { message: 'Прізвище має бути стрічкою, 2 символи та більше.' }),
});
export type EditProfileDto = z.infer<typeof EditProfileSchema>;
export class EditProfileSwaggerDto {
    @ApiProperty({ example: 'uuid', description: "Id користувача" })
    id: string;

    @ApiProperty({ example: 'John', description: "Ім'я користувача" })
    firstName: string;

    @ApiProperty({ example: 'Doe', description: 'Прізвище користувача' })
    lastName: string;
}