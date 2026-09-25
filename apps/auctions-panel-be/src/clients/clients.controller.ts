import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { ClientFilterSchema, ClientSchema, ClientsService } from './clients.service';

@Controller('clients')
export class ClientsController {
  constructor(private readonly clients: ClientsService) { }

  @Get()
  list(@Req() req, @Query() query: unknown) {
    return this.clients.list(req.user, ClientFilterSchema.parse(query));
  }

  @Post()
  create(@Req() req, @Body() body: unknown) {
    return this.clients.create(req.user, ClientSchema.parse(body));
  }

  @Patch(':id')
  update(@Req() req, @Param('id') id: string, @Body() body: unknown) {
    return this.clients.update(req.user, id, ClientSchema.partial().parse(body));
  }

  @Delete(':id')
  remove(@Req() req, @Param('id') id: string) {
    return this.clients.remove(req.user, id);
  }
}
