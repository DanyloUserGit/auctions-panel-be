import { MaterialVisibility, Roles } from '@prisma/client';
import { z } from 'zod';

export const CreateTrainingSchema = z.object({
  title: z.string().trim().min(1, { message: 'Вкажіть заголовок' }).max(300),
  content: z.string().max(200_000),
  imageUrl: z.string().max(1000).nullish(),
  isPublished: z.boolean().optional(),
  visibility: z.nativeEnum(MaterialVisibility).optional(),
  allowedRoles: z.array(z.nativeEnum(Roles)).optional(),
  groupId: z.string().uuid().nullish(),
});
export type CreateTrainingDto = z.infer<typeof CreateTrainingSchema>;

export const UpdateTrainingSchema = CreateTrainingSchema.partial();

export const CreateInfoPageSchema = z.object({
  title: z.string().trim().min(1).max(300),
  slug: z.string().trim().regex(/^[a-z0-9-]+$/, { message: 'slug: лише латинські літери, цифри та дефіс' }),
  content: z.string().max(200_000),
});
export type CreateInfoPageDto = z.infer<typeof CreateInfoPageSchema>;

export const UpdateInfoPageSchema = CreateInfoPageSchema.pick({ title: true, content: true });
export type UpdateInfoPageDto = z.infer<typeof UpdateInfoPageSchema>;
