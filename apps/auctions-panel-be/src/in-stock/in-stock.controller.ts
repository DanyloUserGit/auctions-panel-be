import { Controller, Get, Headers, BadRequestException, Param, Put, Body, Post } from '@nestjs/common';
import { InStockService } from './in-stock.service';

@Controller('in-stock')
export class InStockController {
  constructor(private readonly inStockService: InStockService) { }

  @Get()
  async getCars(@Headers('x-db-name') dbName: string) {
    if (!dbName) {
      // Якщо БД єдина, тут можна задати дефолтне ім'я замість помилки
      throw new BadRequestException('Не вказано заголовок x-db-name');
    }

    return this.inStockService.getInStockCars(dbName);
  }
  @Post()
  async createCar(
    @Headers('x-db-name') dbName: string,
    @Body() carData: any,
  ) {
    if (!dbName) throw new BadRequestException('Не вказано заголовок x-db-name');
    return this.inStockService.createCar(dbName, carData);
  }

  @Put(':id')
  async updateCar(
    @Headers('x-db-name') dbName: string,
    @Param('id') id: string,
    @Body() carData: any,
  ) {
    if (!dbName) throw new BadRequestException('Не вказано заголовок x-db-name');
    return this.inStockService.updateCar(dbName, Number(id), carData);
  }
}