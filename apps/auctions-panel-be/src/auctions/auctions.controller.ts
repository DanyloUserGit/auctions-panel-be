import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { AuctionsService } from './auctions.service';
import { AddUserSchema, AddUserSwaggerDto, type AddUserDto } from './dto/add-user.dto';
import {
  CreateAuctionSchema,
  CreateAuctionSwaggerDto,
  type CreateAuctionDto,
} from './dto/create-auction.dto';
import { UpdateAuctionSchema, type UpdateAuctionDto } from './dto/update-auction.dto';
import { Public } from '../decorators/public.decorator';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) {}

  @Get('search')
  @Public()
  search(@Query('q') query: string, @Query('auctionGroupId') auctionGroupId: string, @Req() req) {
    return this.auctionsService.search({
      user: req.user,
      query,
      auctionGroupId,
    });
  }

  @Post(':id/add-user')
  @Public()
  @ApiBody({ type: AddUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddUserSwaggerDto) }],
    },
  })
  addUser(@Param('id') auctionId: string, @Body() body: AddUserDto) {
    const data = AddUserSchema.parse(body);
    return this.auctionsService.addUser(auctionId, data.userId);
  }
  @Delete(':id/remove-user')
  @Public()
  @ApiBody({ type: AddUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddUserSwaggerDto) }],
    },
  })
  removeUser(@Param('id') auctionId: string, @Body() body: AddUserDto) {
    const data = AddUserSchema.parse(body);
    return this.auctionsService.removeUser(auctionId, data.userId);
  }

  @Post()
  @Public()
  @ApiBody({ type: CreateAuctionSwaggerDto })
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
        { $ref: getSchemaPath(CreateAuctionSwaggerDto) },
      ],
    },
  })
  create(@Body() createAuctionDto: CreateAuctionDto) {
    const data = CreateAuctionSchema.parse(createAuctionDto);
    return this.auctionsService.create(data);
  }

  @Get()
  findAll(@Req() req) {
    return this.auctionsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.auctionsService.findOne(id, req.user);
  }

  @Patch(':id')
  @Public()
  @ApiBody({ type: CreateAuctionSwaggerDto })
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
        { $ref: getSchemaPath(CreateAuctionSwaggerDto) },
      ],
    },
  })
  update(@Param('id') id: string, @Body() updateAuctionDto: UpdateAuctionDto) {
    const data = UpdateAuctionSchema.parse(updateAuctionDto);
    return this.auctionsService.update(id, data);
  }

  @Public()
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionsService.remove(id);
  }
}
