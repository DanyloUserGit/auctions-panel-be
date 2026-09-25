import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, Req } from '@nestjs/common';
import { CreateOrderSchema } from './dto/create-order.dto';
import { UpdateOrderSchema } from './dto/update-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) { }

    @Post()
    create(@Body() body: unknown, @Req() req) {
        return this.ordersService.create(CreateOrderSchema.parse(body), req.user);
    }

    @Get()
    findAll(@Req() req, @Query('search') search?: string) {
        return this.ordersService.findAll(req.user, search);
    }

    @Get(':id')
    findOne(@Param('id', ParseIntPipe) id: number, @Req() req) {
        return this.ordersService.findOne(id, req.user);
    }

    @Patch(':id')
    update(@Param('id', ParseIntPipe) id: number, @Body() body: unknown, @Req() req) {
        return this.ordersService.update(id, UpdateOrderSchema.parse(body), req.user);
    }

    @Delete(':id')
    remove(@Param('id', ParseIntPipe) id: number, @Req() req) {
        return this.ordersService.remove(id, req.user);
    }
}
