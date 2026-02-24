import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { AuctionGroupsService } from './auction-groups.service';
import {
  CreateAuctionGroupSchema,
  CreateAuctionGroupSwaggerDto,
  type CreateAuctionGroupDto,
} from './dto/create-auction-group.dto';
import {
  UpdateAuctionGroupSchema,
  type UpdateAuctionGroupDto,
} from './dto/update-auction-group.dto';
import { Public } from 'src/decorators/public.decorator';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';

@Controller('auction-groups')
export class AuctionGroupsController {
  constructor(private readonly auctionGroupsService: AuctionGroupsService) {}

  @Post()
  @Public()
  @ApiBody({ type: CreateAuctionGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'Uuid' },
          },
        },
        { $ref: getSchemaPath(CreateAuctionGroupSwaggerDto) },
      ],
    },
  })
  create(@Body() createAuctionGroupDto: CreateAuctionGroupDto) {
    const data = CreateAuctionGroupSchema.parse(createAuctionGroupDto);
    return this.auctionGroupsService.create(data);
  }

  @Get()
  findAll() {
    return this.auctionGroupsService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auctionGroupsService.findOne(id);
  }

  @Patch(':id')
  @Public()
  @ApiBody({ type: CreateAuctionGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'Uuid' },
          },
        },
        { $ref: getSchemaPath(CreateAuctionGroupSwaggerDto) },
      ],
    },
  })
  update(@Param('id') id: string, @Body() updateAuctionGroupDto: UpdateAuctionGroupDto) {
    const data = UpdateAuctionGroupSchema.parse(updateAuctionGroupDto);
    return this.auctionGroupsService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionGroupsService.remove(id);
  }
}
