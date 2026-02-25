import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBody, ApiCreatedResponse, getSchemaPath } from '@nestjs/swagger';
import { AuctionAuthService } from './auction-auth.service';
import {
  CreateAuctionAuthSchema,
  CreateAuctionAuthSwaggerDto,
  type CreateAuctionAuthDto,
} from './dto/create-auction-auth.dto';
import { UpdateAuctionAuthSchema, type UpdateAuctionAuthDto } from './dto/update-auction-auth.dto';
import { Public } from '../decorators/public.decorator';

@Controller('auction-auth')
export class AuctionAuthController {
  constructor(private readonly auctionAuthService: AuctionAuthService) {}

  @Post()
  @Public()
  @ApiBody({ type: CreateAuctionAuthSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(CreateAuctionAuthSwaggerDto) }],
    },
  })
  create(@Body() createAuctionAuthDto: CreateAuctionAuthDto) {
    const data = CreateAuctionAuthSchema.parse(createAuctionAuthDto);
    return this.auctionAuthService.create(data);
  }

  @Get(':auctionId')
  findAll(@Param('auctionId') auctionId: string) {
    return this.auctionAuthService.findAll(auctionId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.auctionAuthService.findOne(id);
  }

  @Patch(':id')
  @Public()
  @ApiBody({ type: CreateAuctionAuthSwaggerDto })
  @ApiCreatedResponse({
    description: 'User successfully created',
    schema: {
      allOf: [{ $ref: getSchemaPath(CreateAuctionAuthSwaggerDto) }],
    },
  })
  update(@Param('id') id: string, @Body() updateAuctionAuthDto: UpdateAuctionAuthDto) {
    const data = UpdateAuctionAuthSchema.parse(updateAuctionAuthDto);
    return this.auctionAuthService.update(id, data);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.auctionAuthService.remove(id);
  }
}
