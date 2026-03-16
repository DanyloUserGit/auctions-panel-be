import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiQuery, getSchemaPath } from '@nestjs/swagger';
import { AuctionsService } from './auctions.service';
import { AddPathSchema, AddPathSwaggerDto, type AddPathDto } from './dto/add-path.dto';
import { AddSelectorSchema, AddSelectorSwaggerDto, type AddSelectorDto } from './dto/add-selector.dto';
import { AddUserSchema, AddUserSwaggerDto, type AddUserDto } from './dto/add-user.dto';
import {
  CreateAuctionSchema,
  CreateAuctionSwaggerDto,
  type CreateAuctionDto,
} from './dto/create-auction.dto';
import { UpdateAuctionSchema, type UpdateAuctionDto } from './dto/update-auction.dto';

@Controller('auctions')
export class AuctionsController {
  constructor(private readonly auctionsService: AuctionsService) { }

  @Get('search')
  @ApiQuery({ name: 'auctionGroupId', required: false, type: String })
  search(@Query('q') query: string, @Req() req, @Query('auctionGroupId') auctionGroupId?: string) {
    return this.auctionsService.search({
      user: req.user,
      query,
      auctionGroupId,
    });
  }

  @Get('forbidden-paths')
  getForbiddenPath() {
    return this.auctionsService.getForbiddenPath();
  }

  @Get('forbidden-selectors')
  getForbiddenSelector() {
    return this.auctionsService.getForbiddenSelector();
  }

  @Get('allowed-paths')
  getAllowedPath() {
    return this.auctionsService.getAllowedPath();
  }

  @Post(':id/add-user')
  @ApiBody({ type: AddUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully added',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddUserSwaggerDto) }],
    },
  })
  addUser(@Param('id') auctionId: string, @Body() body: AddUserDto) {
    const data = AddUserSchema.parse(body);
    return this.auctionsService.addUser(auctionId, data.userId);
  }

  @Post(':id/selector')
  @ApiBody({ type: AddSelectorSwaggerDto })
  @ApiCreatedResponse({
    description: 'Selector is now forbidden',
  })
  addSelector(@Param('id') auctionId: string, @Body() body: AddSelectorDto) {
    const data = AddSelectorSchema.parse(body);
    return this.auctionsService.addSelector(auctionId, data);
  }

  @Post(':id/allowed')
  @ApiBody({ type: AddPathSwaggerDto })
  @ApiCreatedResponse({
    description: 'Path is allowed',
  })
  addPathAllowed(@Param('id') auctionId: string, @Body() body: AddPathDto) {
    const data = AddPathSchema.parse(body);
    return this.auctionsService.addPathAllowed(auctionId, data);
  }

  @Post(':id/forbidden')
  @ApiBody({ type: AddPathSwaggerDto })
  @ApiCreatedResponse({
    description: 'Path is allowed',
  })
  addPathForbidden(@Param('id') auctionId: string, @Body() body: AddPathDto) {
    const data = AddPathSchema.parse(body);
    return this.auctionsService.addPathForbidden(auctionId, data);
  }

  @Delete('remove-allowed-path/:id')
  @ApiCreatedResponse({
    description: 'Path deleted',
  })
  deletePathAllowed(@Param('id') id: string) {
    return this.auctionsService.deletePathAllowed(id);
  }

  @Delete('remove-forbidden-path/:id')
  @ApiCreatedResponse({
    description: 'Path deleted',
  })
  deletePathForbidden(@Param('id') id: string) {
    return this.auctionsService.deletePathForbidden(id);
  }

  @Delete('remove-forbidden-selector/:id')
  @ApiCreatedResponse({
    description: 'Path deleted',
  })
  deleteSelectorForbidden(@Param('id') id: string) {
    return this.auctionsService.deleteSelector(id);
  }


  @Delete(':id/remove-user')
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

  @Get(':groupId')
  findAll(@Req() req, @Param('groupId') groupId: string) {
    return this.auctionsService.findAll(groupId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.auctionsService.findOne(id, req.user);
  }

  @Patch(':id')

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


  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionsService.remove(id);
  }
}
