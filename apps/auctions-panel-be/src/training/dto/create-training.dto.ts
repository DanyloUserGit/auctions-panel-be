import { IsString, IsOptional, IsBoolean, IsEnum, IsArray, IsUUID } from 'class-validator';
import { MaterialVisibility, Roles } from '@prisma/client';

export class CreateTrainingDto {
  @IsString()
  title: string;

  @IsString()
  content: string;

  @IsOptional()
  @IsString()
  imageUrl?: string;

  @IsOptional()
  @IsBoolean()
  isPublished?: boolean;

  @IsOptional()
  @IsEnum(MaterialVisibility)
  visibility?: MaterialVisibility;

  @IsOptional()
  @IsArray()
  @IsEnum(Roles, { each: true })
  allowedRoles?: Roles[];

  @IsOptional()
  @IsUUID()
  groupId?: string;
}

export class CreateInfoPageDto {
  @IsString()
  title: string;

  @IsString()
  slug: string;

  @IsString()
  content: string;
}