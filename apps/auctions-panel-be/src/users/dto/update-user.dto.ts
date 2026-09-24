import { z } from 'zod';
import { CreateUserSchema } from './create-user.dto';

// sessionLimit перевизначено без .default(1): інакше кожен PATCH без цього поля скидав ліміт до 1.
export const UpdateUserSchema = CreateUserSchema.extend({
  sessionLimit: z.number().int().min(1).optional(),
}).partial();

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
