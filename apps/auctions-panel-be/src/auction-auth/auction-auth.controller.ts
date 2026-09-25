import { Audit } from '../audit-log/audit.decorator';
import { Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { Roles } from '@prisma/client';
import { JwtAuthGuard } from '../auth/auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { AuctionAuthService } from './auction-auth.service';
import {
  CreateAuctionAuthSchema,
  CreateAuctionAuthSwaggerDto,
  type CreateAuctionAuthDto,
} from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthSchema, type UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';

@UseGuards(JwtAuthGuard)
@Controller('auction-auth')
export class AuctionAuthController {
  constructor(private readonly auctionAuthService: AuctionAuthService) { }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.account.create', 'Створено акаунт аукціону «{result.title}»')
  @Post()
  @ApiBody({ type: CreateAuctionAuthSwaggerDto })
  @ApiCreatedResponse({
    description: 'AccountAuth successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(CreateAuctionAuthSwaggerDto) }],
    },
  })
  create(@Body() createAuctionAuthDto: CreateAuctionAuthDto) {
    const data = CreateAuctionAuthSchema.parse(createAuctionAuthDto);
    return this.auctionAuthService.create(data);
  }

  @Post('select-account')
  selectAccount(@Body() body: { accountId: string }, @Req() req) {
    return this.auctionAuthService.selectAccount(body.accountId, req.user);
  }

  @Get('selected')
  getSelectedAccounts(@Req() req) {
    return this.auctionAuthService.getSelectedAccounts(req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Get('account/:id')
  findOne(@Param('id') id: string) {
    return this.auctionAuthService.findOne(id);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.Admin, Roles.SuperAdmin, Roles.User)
  @Get(':auctionId')
  findAll(@Param('auctionId') auctionId: string, @Req() req) {
    return this.auctionAuthService.findAll(auctionId, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.account.update', 'Змінено акаунт аукціону {params.id}')
  @Patch(':id')
  @ApiBody({ type: CreateAuctionAuthSwaggerDto })
  @ApiCreatedResponse({
    description: 'AccountAuth successfully updated',
    schema: {
      allOf: [{ $ref: getSchemaPath(CreateAuctionAuthSwaggerDto) }],
    },
  })
  update(@Param('id') id: string, @Body() updateAuctionAuthDto: UpdateAuctionAuthDto) {
    const data = UpdateAuctionAuthSchema.parse(updateAuctionAuthDto);
    return this.auctionAuthService.update(id, data);
  }

  @Delete('remove-account/:accountId')
  removeAccount(@Param('accountId') accountId: string, @Req() req) {
    return this.auctionAuthService.removeAccount(accountId, req.user);
  }

  @UseGuards(RolesGuard)
  @RolesDecorator(Roles.SuperAdmin)
  @Audit('catalog.account.delete', 'Видалено акаунт аукціону {params.id}')
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionAuthService.remove(id);
  }
}