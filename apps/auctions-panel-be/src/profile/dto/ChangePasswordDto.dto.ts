import z from "zod";

export const ChangePasswordSchema = z.object({
    password: z.string().min(8, { message: 'Пароль має містити мінімум 8 символів.' }),
});

export type ChangePasswordDto = z.infer<typeof ChangePasswordSchema>;