import { Controller, Get, Post, Body, Patch, Param, Delete } from '@nestjs/common';
import { AuctionGroupsService } from './auction-groups.service';
import { CreateAuctionGroupDto } from './dto/create-auction-group.dto';
import { UpdateAuctionGroupDto } from './dto/update-auction-group.dto';

@Controller('auction-groups')
export class AuctionGroupsController {
  constructor(private readonly auctionGroupsService: AuctionGroupsService) {}

  @Post()
  create(@Body() createAuctionGroupDto: CreateAuctionGroupDto) {
    return this.auctionGroupsService.create(createAuctionGroupDto);
  }

  @Get()
  findAll() {
    return this.auctionGroupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auctionGroupsService.findOne(+id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() updateAuctionGroupDto: UpdateAuctionGroupDto) {
    return this.auctionGroupsService.update(+id, updateAuctionGroupDto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionGroupsService.remove(+id);
  }
}
