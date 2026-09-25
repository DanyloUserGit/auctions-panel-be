import { z } from 'zod';
import { CreateUserSchema } from './create-user.dto';

// sessionLimit перевизначено без .default(0): інакше кожен PATCH без цього поля скидав би особистий ліміт.
// Статус доступу змінюється лише окремим запитом із причиною (PATCH /users/:id/status).
export const UpdateUserSchema = CreateUserSchema.omit({ accessStatus: true, statusReason: true })
  .extend({
    sessionLimit: z.number().int().min(0).optional(),
  })
  .partial();

export type UpdateUserDto = z.infer<typeof UpdateUserSchema>;
