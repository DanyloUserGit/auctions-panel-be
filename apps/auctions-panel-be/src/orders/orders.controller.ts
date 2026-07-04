import { BadRequestException, Body, Controller, Delete, Get, Headers, Param, Patch, Post, Query, Req } from '@nestjs/common';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) { }

    private getDbName(headers: Record<string, string>): string {
        const dbName = headers['x-client-db'];
        if (!dbName) {
            throw new BadRequestException('Заголовок x-client-db обов\'язковий');
        }
        return dbName;
    }

    @Post()
    create(@Headers() headers, @Body() createOrderDto: CreateOrderDto, @Req() req) {
        const dbName = this.getDbName(headers);
        const user = req.user;
        console.log(user)
        return this.ordersService.create(dbName, createOrderDto, user);
    }

    @Get()
    findAll(@Headers() headers, @Req() req, @Query('search') search?: string) {
        const dbName = this.getDbName(headers);
        const user = req.user;
        return this.ordersService.findAll(dbName, user, search);
    }

    @Get(':id')
    findOne(@Headers() headers, @Param('id') id: string) {
        const dbName = this.getDbName(headers);
        return this.ordersService.findOne(dbName, +id);
    }

    @Patch(':id')
    update(@Headers() headers, @Param('id') id: string, @Body() updateOrderDto: UpdateOrderDto) {
        const dbName = this.getDbName(headers);
        return this.ordersService.update(dbName, +id, updateOrderDto);
    }

    @Delete(':id')
    remove(@Headers() headers, @Param('id') id: string) {
        const dbName = this.getDbName(headers);
        return this.ordersService.remove(dbName, +id);
    }
}