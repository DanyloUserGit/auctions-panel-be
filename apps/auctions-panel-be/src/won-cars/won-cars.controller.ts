import { Body, Controller, Get, Param, ParseIntPipe, Patch, Query, Req } from '@nestjs/common';
import { WonCarsService } from './won-cars.service';

@Controller('purchases')
export class WonCarsController {
    constructor(private readonly wonCarsService: WonCarsService) { }

    @Get()
    async getPurchases(@Req() req, @Query('page') page = '1') {
        const limit = 20;
        const offset = (Math.max(1, Number(page) || 1) - 1) * limit;
        return this.wonCarsService.getWonCarsData(req.user, limit, offset);
    }

    // Дані авто для форми «Виставити на продаж».
    @Get(':id')
    getPurchase(@Req() req, @Param('id', ParseIntPipe) id: number) {
        return this.wonCarsService.getWonCar(req.user, id);
    }

    @Patch(':id/status')
    updateStatus(@Req() req, @Param('id', ParseIntPipe) id: number, @Body('status', ParseIntPipe) status: number) {
        return this.wonCarsService.updateCarStatus(req.user, id, status);
    }
}
