import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { z } from 'zod';

export const CreateAuctionGroupSchema = z.object({
  title: z.string().min(1),
  sessionLimit: z.number().int().min(0).optional(),
  auctions: z.array(z.string().uuid()).optional(),
});

export type CreateAuctionGroupDto = z.infer<typeof CreateAuctionGroupSchema>;

export class CreateAuctionGroupSwaggerDto implements CreateAuctionGroupDto {
  @ApiProperty({ example: 'Основна група' })
  title!: string;

  @ApiPropertyOptional({ example: 5 })
  sessionLimit?: number;

  @ApiPropertyOptional({ type: [String] })
  auctions?: string[];
}