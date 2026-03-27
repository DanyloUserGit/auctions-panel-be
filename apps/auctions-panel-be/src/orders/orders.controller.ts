import { Controller, Get, Post, Body, Patch, Param, Delete, Headers, BadRequestException, Query } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Controller('orders')
export class OrdersController {
    constructor(private readonly ordersService: OrdersService) { }

    // Допоміжний метод для отримання клієнтської БД
    private getDbName(headers: Record<string, string>): string {
        const dbName = headers['x-client-db'];
        if (!dbName) {
            throw new BadRequestException('Заголовок x-client-db обов\'язковий');
        }
        return dbName;
    }

    @Post()
    create(@Headers() headers, @Body() createOrderDto: CreateOrderDto) {
        const dbName = this.getDbName(headers);
        return this.ordersService.create(dbName, createOrderDto);
    }

    @Get()
    findAll(@Headers() headers, @Query('search') search?: string) {
        const dbName = this.getDbName(headers);
        // Передаємо параметр пошуку в сервіс
        return this.ordersService.findAll(dbName, search);
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