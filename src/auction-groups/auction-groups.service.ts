import { Injectable } from '@nestjs/common';
import { CreateAuctionGroupDto } from './dto/create-auction-group.dto';
import { UpdateAuctionGroupDto } from './dto/update-auction-group.dto';

@Injectable()
export class AuctionGroupsService {
  create(createAuctionGroupDto: CreateAuctionGroupDto) {
    return 'This action adds a new auctionGroup';
  }

  findAll() {
    return `This action returns all auctionGroups`;
  }

  findOne(id: number) {
    return `This action returns a #${id} auctionGroup`;
  }

  update(id: number, updateAuctionGroupDto: UpdateAuctionGroupDto) {
    return `This action updates a #${id} auctionGroup`;
  }

  remove(id: number) {
    return `This action removes a #${id} auctionGroup`;
  }
}
