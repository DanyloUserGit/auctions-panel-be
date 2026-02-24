import { PartialType } from '@nestjs/swagger';
import { CreateAuctionGroupDto } from './create-auction-group.dto';

export class UpdateAuctionGroupDto extends PartialType(CreateAuctionGroupDto) {}
