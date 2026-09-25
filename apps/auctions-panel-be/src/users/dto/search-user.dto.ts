import { ApiProperty } from '@nestjs/swagger';
import { z } from 'zod';
import { AccessStatus, Roles } from '@prisma/client';

export const SearchUserSchema = z.object({
  query: z.string().trim().optional(),
  role: z.nativeEnum(Roles).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(10),
});

export type SearchUserDto = z.infer<typeof SearchUserSchema>;

export class UserResponseDto {
  @ApiProperty({ example: 'uuid' })
  id: string;

  @ApiProperty({ example: 'Ivan' })
  firstName: string;

  @ApiProperty({ example: 'Petrenko' })
  lastName: string;

  @ApiProperty({ example: 'ivan@gmail.com' })
  email: string;

  @ApiProperty({ enum: Roles })
  role: Roles;

  @ApiProperty({ enum: AccessStatus })
  accessStatus: AccessStatus;
}
export class PaginationMetaDto {
  @ApiProperty({ example: 100 })
  total: number;

  @ApiProperty({ example: 1 })
  page: number;

  @ApiProperty({ example: 10 })
  lastPage: number;
}
export class SearchUserResponseDto {
  @ApiProperty({ type: [UserResponseDto] })
  data: UserResponseDto[];

  @ApiProperty({ type: PaginationMetaDto })
  meta: PaginationMetaDto;
}
