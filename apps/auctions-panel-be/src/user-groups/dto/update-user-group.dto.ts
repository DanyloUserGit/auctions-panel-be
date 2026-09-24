import { z } from 'zod';
import { CreateUserGroupSchema } from './create-user-group.dto';

export const UpdateUserGroupSchema = CreateUserGroupSchema.partial();

export type UpdateUserGroupDto = z.infer<typeof UpdateUserGroupSchema>;