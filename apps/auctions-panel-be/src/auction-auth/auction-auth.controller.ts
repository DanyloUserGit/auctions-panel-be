import { Body, Controller, Delete, Get, Param, Patch, Post, Req } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { AuctionAuthService } from './auction-auth.service';
import {
  CreateAuctionAuthSchema,
  CreateAuctionAuthSwaggerDto,
  type CreateAuctionAuthDto,
} from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthSchema, type UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';

@Controller('auction-auth')
export class AuctionAuthController {
  constructor(private readonly auctionAuthService: AuctionAuthService) { }

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

  @Post("select-account")
  selectAccount(@Body() body: { accountId: string }, @Req() req) {
    return this.auctionAuthService.selectAccount(body.accountId, req.user);
  }

  @Get('selected')
  getSelectedAccounts(@Req() req) {
    return this.auctionAuthService.getSelectedAccounts(req.user);
  }

  @Get('account/:id')
  findOne(@Param('id') id: string) {
    return this.auctionAuthService.findOne(id);
  }

  @Get(':auctionId')
  findAll(@Param('auctionId') auctionId: string) {
    return this.auctionAuthService.findAll(auctionId);
  }

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

  @Delete("remove-account/:accountId")
  removeAccount(@Param("accountId") accountId: string, @Req() req) {
    return this.auctionAuthService.removeAccount(accountId, req.user);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionAuthService.remove(id);
  }

}
