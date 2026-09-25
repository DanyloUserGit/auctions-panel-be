import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
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

@Controller('auction-groups')
export class AuctionGroupsController {
  constructor(private readonly auctionGroupsService: AuctionGroupsService) { }

  @Get('search')
  search(@Query('q') query: string, @Req() req) {
    return this.auctionGroupsService.search(req.user, query);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.auction-group.add-auction', 'До групи аукціонів {params.id} додано аукціон {body.auctionId}')
  @Post(':id/add-auction')
  @ApiBody({ type: AddAuctionSwaggerDto })
  @ApiCreatedResponse({
    description: 'Auction attached to group',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionSwaggerDto) }],
    },
  })
  addAuction(@Param('id') groupId: string, @Body() body: AddAuctionDto) {
    const data = AddAuctionSchema.parse(body);
    return this.auctionGroupsService.addAuction(groupId, data.auctionId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.auction-group.remove-auction', 'З групи аукціонів {params.id} прибрано аукціон {body.auctionId}')
  @Delete(':id/remove-auction')
  @ApiBody({ type: AddAuctionSwaggerDto })
  @ApiCreatedResponse({
    description: 'Auction detached from group',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionSwaggerDto) }],
    },
  })
  removeAuction(@Param('id') groupId: string, @Body() body: AddAuctionDto) {
    const data = AddAuctionSchema.parse(body);
    return this.auctionGroupsService.removeAuction(groupId, data.auctionId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.auction-group.create', 'Створено групу аукціонів «{result.title}»')
  @Post()
  @ApiBody({ type: CreateAuctionGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'Auction group successfully created',
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
    return this.auctionGroupsService.create(data, req.user);
  }

  @Get()
  findAll(@Req() req) {
    return this.auctionGroupsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.auctionGroupsService.findOne(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.auction-group.update', 'Змінено групу аукціонів «{result.title}»')
  @Patch(':id')
  @ApiBody({ type: CreateAuctionGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'Auction group successfully updated',
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
  update(@Param('id') id: string, @Body() updateAuctionGroupDto: UpdateAuctionGroupDto, @Req() req) {
    const data = UpdateAuctionGroupSchema.parse(updateAuctionGroupDto);
    return this.auctionGroupsService.update(id, data, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.auction-group.delete', 'Видалено групу аукціонів {params.id}')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionGroupsService.remove(id);
  }
}