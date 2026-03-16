import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { AuctionGroupsService } from './auction-groups.service';
import { AddAuctionSchema, AddAuctionSwaggerDto, type AddAuctionDto } from './dto/add-auction.dto';
import {
  CreateAuctionGroupSchema,
  CreateAuctionGroupSwaggerDto,
  type CreateAuctionGroupDto,
} from './dto/create-auction-group.dto';
import {
  UpdateAuctionGroupSchema,
  type UpdateAuctionGroupDto,
} from './dto/update-auction-group.dto';
import { Public } from '../decorators/public.decorator';

@Controller('auction-groups')
export class AuctionGroupsController {
  constructor(private readonly auctionGroupsService: AuctionGroupsService) {}

  @Get('search')
  search(@Query('q') query: string, @Req() req) {
    return this.auctionGroupsService.search({
      user: req.user,
      query,
    });
  }
  
  @Post(':id/add-auction')
  @Public()
  @ApiBody({ type: AddAuctionSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionSwaggerDto) }],
    },
  })
  addUser(@Param('id') auctionId: string, @Body() body: AddAuctionDto) {
    const data = AddAuctionSchema.parse(body);
    return this.auctionGroupsService.addAuction(auctionId, data.auctionId);
  }
  @Delete(':id/remove-user')
  @Public()
  @ApiBody({ type: AddAuctionSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionSwaggerDto) }],
    },
  })
  removeUser(@Param('id') auctionId: string, @Body() body: AddAuctionDto) {
    const data = AddAuctionSchema.parse(body);
    return this.auctionGroupsService.removeAuction(auctionId, data.auctionId);
  }
  @Post()
  // @Public()
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
  create(@Body() createAuctionGroupDto: CreateAuctionGroupDto, @Req() req) {
    const data = CreateAuctionGroupSchema.parse(createAuctionGroupDto);
    return this.auctionGroupsService.create({...data, Admin:req.user.id});
  }

  @Get()
  findAll(@Req() req) {
    return this.auctionGroupsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.auctionGroupsService.findOne(id, req.user);
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
