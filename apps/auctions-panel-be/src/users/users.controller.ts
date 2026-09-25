import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  getSchemaPath,
} from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { AddAccountSchema, AddAccountSwaggerDto, type AddAccountDto } from '../user-groups/dto/add-account.dto';
import {
  AddAuctionGroupSchema,
  AddAuctionGroupSwaggerDto,
  type AddAuctionGroupDto,
} from '../user-groups/dto/add-auction-group.dto';
import { AddAuctionSchema, AddAuctionSwaggerDto, type AddAuctionDto } from '../user-groups/dto/add-auction.dto';
import { CreateUserSchema, CreateUserSwaggerDto, type CreateUserDto } from './dto/create-user.dto';
import { SearchUserResponseDto, SearchUserSchema } from './dto/search-user.dto';
import { UpdateUserSchema, type UpdateUserDto } from './dto/update-user.dto';
import {
  UpdateUserStatusSchema,
  UpdateUserStatusSwaggerDto,
  type UpdateUserStatusDto,
} from './dto/update-user-status.dto';
import { UsersService } from './users.service';

@ApiTags('users')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) { }

  @Get('search')
  @ApiOperation({ summary: 'Search users with pagination' })
  @ApiOkResponse({
    description: 'Users found successfully',
    type: SearchUserResponseDto,
  })
  async search(@Query() query: unknown, @Req() req): Promise<SearchUserResponseDto> {
    return this.usersService.searchUsers(SearchUserSchema.parse(query), req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Post()
  @ApiBody({ type: CreateUserSwaggerDto })
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
        { $ref: getSchemaPath(CreateUserSwaggerDto) },
      ],
    },
  })
  create(@Body() createUserDto: CreateUserDto, @Req() req) {
    const data = CreateUserSchema.parse(createUserDto);
    return this.usersService.create(data, req.user);
  }

  @Get()
  findAll(
    @Req() req
  ) {
    const user = req.user;
    return this.usersService.findAll(user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.usersService.findOneForRequester(id, req.user);
  }

  @Patch(':id')
  @ApiBody({ type: CreateUserSwaggerDto })
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
        { $ref: getSchemaPath(CreateUserSwaggerDto) },
      ],
    },
  })
  update(@Param('id') id: string, @Body() updateUserDto: UpdateUserDto, @Req() req) {
    const data = UpdateUserSchema.parse(updateUserDto);
    return this.usersService.update(id, data, req.user);
  }

  @Get(':id/control-card')
  @ApiOperation({ summary: 'Отримати картку контролю користувача (ТЗ 15.3)' })
  async getControlCard(@Param('id') id: string, @Req() req) {
    return this.usersService.getUserControlCard(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Patch(':id/status')
  @ApiOperation({ summary: 'Зміна статусу/блокування користувача' })
  @ApiBody({ type: UpdateUserStatusSwaggerDto })
  async updateStatus(@Param('id') id: string, @Body() statusDto: UpdateUserStatusDto, @Req() req) {
    const data = UpdateUserStatusSchema.parse(statusDto);
    return this.usersService.updateUserStatus(id, data, req.user);
  }

  // --- Особисті дозволи користувача (власний ланцюг доступу) ---

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Get(':id/access')
  @ApiOperation({ summary: 'Особисті дозволи користувача (групи аукціонів / аукціони / акаунти)' })
  getPersonalAccess(@Param('id') id: string, @Req() req) {
    return this.usersService.getPersonalAccess(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Post(':id/add-auction-group')
  @ApiBody({ type: AddAuctionGroupSwaggerDto })
  addPersonalAuctionGroup(@Param('id') id: string, @Body() body: AddAuctionGroupDto, @Req() req) {
    const data = AddAuctionGroupSchema.parse(body);
    return this.usersService.setPersonalAccess(id, 'auctionGroup', data.auctionGroupId, true, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Delete(':id/remove-auction-group')
  @ApiBody({ type: AddAuctionGroupSwaggerDto })
  removePersonalAuctionGroup(@Param('id') id: string, @Body() body: AddAuctionGroupDto, @Req() req) {
    const data = AddAuctionGroupSchema.parse(body);
    return this.usersService.setPersonalAccess(id, 'auctionGroup', data.auctionGroupId, false, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Post(':id/add-auction')
  @ApiBody({ type: AddAuctionSwaggerDto })
  addPersonalAuction(@Param('id') id: string, @Body() body: AddAuctionDto, @Req() req) {
    const data = AddAuctionSchema.parse(body);
    return this.usersService.setPersonalAccess(id, 'auction', data.auctionId, true, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Delete(':id/remove-auction')
  @ApiBody({ type: AddAuctionSwaggerDto })
  removePersonalAuction(@Param('id') id: string, @Body() body: AddAuctionDto, @Req() req) {
    const data = AddAuctionSchema.parse(body);
    return this.usersService.setPersonalAccess(id, 'auction', data.auctionId, false, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Post(':id/add-account')
  @ApiBody({ type: AddAccountSwaggerDto })
  addPersonalAccount(@Param('id') id: string, @Body() body: AddAccountDto, @Req() req) {
    const data = AddAccountSchema.parse(body);
    return this.usersService.setPersonalAccess(id, 'account', data.accountId, true, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Delete(':id/remove-account')
  @ApiBody({ type: AddAccountSwaggerDto })
  removePersonalAccount(@Param('id') id: string, @Body() body: AddAccountDto, @Req() req) {
    const data = AddAccountSchema.parse(body);
    return this.usersService.setPersonalAccess(id, 'account', data.accountId, false, req.user);
  }

  // --- Заборона учаснику окремих акаунтів групи (canGaManageAccounts) ---

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Post(':id/deny-account')
  @ApiBody({ type: AddAccountSwaggerDto })
  denyAccount(@Param('id') id: string, @Body() body: AddAccountDto, @Req() req) {
    const data = AddAccountSchema.parse(body);
    return this.usersService.setDeniedAccount(id, data.accountId, true, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete(':id/deny-account')
  @ApiBody({ type: AddAccountSwaggerDto })
  undenyAccount(@Param('id') id: string, @Body() body: AddAccountDto, @Req() req) {
    const data = AddAccountSchema.parse(body);
    return this.usersService.setDeniedAccount(id, data.accountId, false, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Delete(':id')
  remove(@Param('id') id: string, @Req() req) {
    return this.usersService.remove(id, req.user);
  }
}
