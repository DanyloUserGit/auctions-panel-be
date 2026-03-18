import { IsNumber, IsBoolean, IsOptional, IsEnum, Min } from 'class-validator';
import { LogSeverity } from '@prisma/client';

export class UpdateGlobalSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  inactivityTimeout?: number; 

  @IsOptional()
  @IsNumber()
  @Min(1)
  globalSessionLimit?: number;

  @IsOptional()
  @IsBoolean()
  gaCanAssignGa?: boolean;

  @IsOptional()
  @IsEnum(LogSeverity)
  loggingPolicy?: LogSeverity; 
}