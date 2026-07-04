import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, ApiQuery, getSchemaPath } from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
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

@UseGuards(JwtAuthGuard)
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

  @Get(':id/forbidden-paths')
  getForbiddenPath(@Param('id') auctionId: string) {
    return this.auctionsService.getForbiddenPath(auctionId);
  }

  @Get(':id/forbidden-selectors')
  getForbiddenSelector(@Param('id') auctionId: string, @Req() req) {
    return this.auctionsService.getForbiddenSelector(auctionId, req.user);
  }

  @Get(':id/allowed-paths')
  getAllowedPath(@Param('id') auctionId: string) {
    return this.auctionsService.getAllowedPath(auctionId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Post(':id/add-user')
  @ApiBody({ type: AddUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully added',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddUserSwaggerDto) }],
    },
  })
  addUser(@Param('id') auctionId: string, @Body() body: AddUserDto, @Req() req) {
    const data = AddUserSchema.parse(body);
    return this.auctionsService.addUser(auctionId, data.userId, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Post(':id/selector')
  @ApiBody({ type: AddSelectorSwaggerDto })
  @ApiCreatedResponse({
    description: 'Selector is now forbidden',
  })
  addSelector(@Param('id') auctionId: string, @Body() body: AddSelectorDto, @Req() req) {
    const data = AddSelectorSchema.parse(body);
    return this.auctionsService.addSelector(auctionId, data, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Post(':id/allowed')
  @ApiBody({ type: AddPathSwaggerDto })
  @ApiCreatedResponse({
    description: 'Path is allowed',
  })
  addPathAllowed(@Param('id') auctionId: string, @Body() body: AddPathDto, @Req() req) {
    const data = AddPathSchema.parse(body);
    return this.auctionsService.addPathAllowed(auctionId, data, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Post(':id/forbidden')
  @ApiBody({ type: AddPathSwaggerDto })
  @ApiCreatedResponse({
    description: 'Path is allowed',
  })
  addPathForbidden(@Param('id') auctionId: string, @Body() body: AddPathDto, @Req() req) {
    const data = AddPathSchema.parse(body);
    return this.auctionsService.addPathForbidden(auctionId, data, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete('remove-allowed-path/:id')
  @ApiCreatedResponse({
    description: 'Path deleted',
  })
  deletePathAllowed(@Param('id') id: string, @Req() req) {
    return this.auctionsService.deletePathAllowed(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete('remove-forbidden-path/:id')
  @ApiCreatedResponse({
    description: 'Path deleted',
  })
  deletePathForbidden(@Param('id') id: string, @Req() req) {
    return this.auctionsService.deletePathForbidden(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete('remove-forbidden-selector/:id')
  @ApiCreatedResponse({
    description: 'Path deleted',
  })
  deleteSelectorForbidden(@Param('id') id: string, @Req() req) {
    return this.auctionsService.deleteSelector(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete(':id/remove-user')
  @ApiBody({ type: AddUserSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddUserSwaggerDto) }],
    },
  })
  removeUser(@Param('id') auctionId: string, @Body() body: AddUserDto, @Req() req) {
    const data = AddUserSchema.parse(body);
    return this.auctionsService.removeUser(auctionId, data.userId, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
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
  create(@Body() createAuctionDto: CreateAuctionDto, @Req() req) {
    const data = CreateAuctionSchema.parse(createAuctionDto);
    return this.auctionsService.create(data, req.user);
  }

  @Get('group/:groupId')
  findAll(@Req() req, @Param('groupId') groupId: string) {
    return this.auctionsService.findAll(groupId, req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.auctionsService.findOne(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
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
  update(@Param('id') id: string, @Body() updateAuctionDto: UpdateAuctionDto, @Req() req) {
    const data = UpdateAuctionSchema.parse(updateAuctionDto);
    return this.auctionsService.update(id, data, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req) {
    return this.auctionsService.remove(id, req.user);
  }
}