import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { UserGroupsService } from './user-groups.service';
import { AddAuctionSchema, AddAuctionSwaggerDto, type AddAuctionDto } from './dto/add-auction.dto'
import {
  AddAuctionGroupSchema,
  AddAuctionGroupSwaggerDto,
  type AddAuctionGroupDto,
} from './dto/add-auction-group.dto';
import { AddAccountSchema, AddAccountSwaggerDto, type AddAccountDto } from './dto/add-account.dto';
import {
  CreateUserGroupSchema,
  CreateUserGroupSwaggerDto,
  type CreateUserGroupDto,
} from './dto/create-user-group.dto';
import {
  UpdateUserGroupSchema,
  type UpdateUserGroupDto,
} from './dto/update-user-group.dto';

@Controller('user-groups')
export class UserGroupsController {
  constructor(private readonly userGroupsService: UserGroupsService) { }

  @Get('search')
  search(@Query('q') query: string, @Req() req) {
    return this.userGroupsService.search({
      user: req.user,
      query,
    });
  }

  // Учасники групи - лише SuperAdmin або адміністратор цієї групи.
  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Get('users/:id')
  async getUsersByGroupId(@Param('id') groupId: string, @Req() req) {
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.getUsersByGroupId(groupId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Audit('group.remove-user', 'Користувача вилучено з групи {params.id}')
  @Patch('remove-user/:id')
  async removeUserFromGroup(
    @Param('id') groupId: string,
    @Body() body: { userId: string },
    @Req() req
  ) {
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.removeUserFromGroup(groupId, body.userId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Audit('group.block', 'Групу користувачів {params.id} заблоковано')
  @Post(':id/block-group')
  async blockGroup(@Param('id') groupId: string, @Req() req) {
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.blockGroup(groupId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Audit('group.unblock', 'Групу користувачів {params.id} розблоковано')
  @Post(':id/unblock-group')
  async unBlockGroup(@Param('id') groupId: string, @Req() req) {
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.unBlockGroup(groupId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('access.group.grant', 'Групі {params.id} надано доступ до аукціону {body.auctionId}')
  @Post(':id/add-auction')
  @ApiBody({ type: AddAuctionSwaggerDto })
  @ApiCreatedResponse({
    description: 'Auction added to allowed list',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionSwaggerDto) }],
    },
  })
  async addAllowedAuction(@Param('id') groupId: string, @Body() body: AddAuctionDto, @Req() req) {
    const data = AddAuctionSchema.parse(body);
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.addAllowedAuction(groupId, data.auctionId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('access.group.revoke', 'Групі {params.id} закрито доступ до аукціону {body.auctionId}')
  @Delete(':id/remove-auction')
  @ApiBody({ type: AddAuctionSwaggerDto })
  @ApiCreatedResponse({
    description: 'Auction removed from allowed list',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionSwaggerDto) }],
    },
  })
  async removeAllowedAuction(@Param('id') groupId: string, @Body() body: AddAuctionDto, @Req() req) {
    const data = AddAuctionSchema.parse(body);
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.removeAllowedAuction(groupId, data.auctionId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('access.group.grant', 'Групі {params.id} надано доступ до групи аукціонів {body.auctionGroupId}')
  @Post(':id/add-auction-group')
  @ApiBody({ type: AddAuctionGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'Групу аукціонів додано до дозволених для групи користувачів',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionGroupSwaggerDto) }],
    },
  })
  async addAllowedAuctionGroup(@Param('id') groupId: string, @Body() body: AddAuctionGroupDto, @Req() req) {
    const data = AddAuctionGroupSchema.parse(body);
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.addAllowedAuctionGroup(groupId, data.auctionGroupId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('access.group.revoke', 'Групі {params.id} закрито доступ до групи аукціонів {body.auctionGroupId}')
  @Delete(':id/remove-auction-group')
  @ApiBody({ type: AddAuctionGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'Групу аукціонів видалено з дозволених для групи користувачів',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAuctionGroupSwaggerDto) }],
    },
  })
  async removeAllowedAuctionGroup(@Param('id') groupId: string, @Body() body: AddAuctionGroupDto, @Req() req) {
    const data = AddAuctionGroupSchema.parse(body);
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.removeAllowedAuctionGroup(groupId, data.auctionGroupId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('access.group.grant', 'Групі {params.id} надано доступ до акаунта {body.accountId}')
  @Post(':id/add-account')
  @ApiBody({ type: AddAccountSwaggerDto })
  @ApiCreatedResponse({
    description: 'Акаунт додано до дозволених для групи користувачів',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAccountSwaggerDto) }],
    },
  })
  async addAllowedAccount(@Param('id') groupId: string, @Body() body: AddAccountDto, @Req() req) {
    const data = AddAccountSchema.parse(body);
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.addAllowedAccount(groupId, data.accountId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('access.group.revoke', 'Групі {params.id} закрито доступ до акаунта {body.accountId}')
  @Delete(':id/remove-account')
  @ApiBody({ type: AddAccountSwaggerDto })
  @ApiCreatedResponse({
    description: 'Акаунт видалено з дозволених для групи користувачів',
    schema: {
      allOf: [{ $ref: getSchemaPath(AddAccountSwaggerDto) }],
    },
  })
  async removeAllowedAccount(@Param('id') groupId: string, @Body() body: AddAccountDto, @Req() req) {
    const data = AddAccountSchema.parse(body);
    await this.userGroupsService.assertCanManageGroup(groupId, req.user);
    return this.userGroupsService.removeAllowedAccount(groupId, data.accountId);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('group.create', 'Створено групу користувачів «{result.name}»')
  @Post()
  @ApiBody({ type: CreateUserGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'User group successfully created',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'Uuid' },
          },
        },
        { $ref: getSchemaPath(CreateUserGroupSwaggerDto) },
      ],
    },
  })
  create(@Body() createUserGroupDto: CreateUserGroupDto, @Req() req) {
    const data = CreateUserGroupSchema.parse(createUserGroupDto);
    return this.userGroupsService.create(data, req.user);
  }

  @Get()
  findAll(@Req() req) {
    return this.userGroupsService.findAll(req.user);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @Req() req) {
    return this.userGroupsService.findOne(id, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin)
  @Audit('group.update', 'Змінено налаштування групи користувачів «{result.name}»')
  @Patch(':id')
  @ApiBody({ type: CreateUserGroupSwaggerDto })
  @ApiCreatedResponse({
    description: 'User group successfully updated',
    schema: {
      allOf: [
        {
          type: 'object',
          properties: {
            id: { type: 'string', example: 'Uuid' },
          },
        },
        { $ref: getSchemaPath(CreateUserGroupSwaggerDto) },
      ],
    },
  })
  async update(@Param('id') id: string, @Body() updateUserGroupDto: UpdateUserGroupDto, @Req() req) {
    const data = UpdateUserGroupSchema.parse(updateUserGroupDto);
    await this.userGroupsService.assertCanManageGroup(id, req.user);
    return this.userGroupsService.update(id, data, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('group.delete', 'Видалено групу користувачів «{result.name}»')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.userGroupsService.remove(id);
  }
}