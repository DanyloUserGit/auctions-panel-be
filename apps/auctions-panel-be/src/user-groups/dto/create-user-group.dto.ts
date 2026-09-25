import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateUserGroupSchema = z.object({
  name: z.string().min(1),
  canGaManageAccounts: z.boolean().optional(),
  canGaManageRules: z.boolean().optional(),
  showAccounts: z.boolean().optional(),
  // Ліміт одночасних сесій учасників групи; 0 - без ліміту.
  sessionLimit: z.number().int().min(0).optional(),
  rules: z.any().optional(),
  allowedProfileFields: z.array(z.string()).optional(),
  allowedAuctions: z.array(z.string().uuid()).optional(),
  Admin: z.string().uuid().optional(),
  users: z.array(z.string().uuid()).optional(),
});

export type CreateUserGroupDto = z.infer<typeof CreateUserGroupSchema>;

export class CreateUserGroupSwaggerDto implements CreateUserGroupDto {
  @ApiProperty({ example: 'Основна група користувачів' })
  name!: string;

  @ApiPropertyOptional()
  canGaManageAccounts?: boolean;

  @ApiPropertyOptional()
  showAccounts?: boolean;

  @ApiPropertyOptional({ example: 0 })
  sessionLimit?: number;

  @ApiPropertyOptional()
  rules?: Record<string, any>;

  @ApiPropertyOptional({ type: [String] })
  allowedProfileFields?: string[];

  @ApiPropertyOptional({ type: [String] })
  allowedAuctions?: string[];

  @ApiPropertyOptional({ example: 'Uuid' })
  Admin?: string;

  @ApiPropertyOptional({ type: [String] })
  users?: string[];
}