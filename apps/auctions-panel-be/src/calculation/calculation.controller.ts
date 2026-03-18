import { Controller, Get, Query, ParseIntPipe } from '@nestjs/common';
import { CalculationService } from './calculation.service';

@Controller('calc')
export class CalculationController {
    constructor(private readonly calcService: CalculationService) { }

    @Get('brands')
    async getBrands(@Query('db') db: string, @Query('table') table: string) {
        return this.calcService.getBrands(db, table);
    }

    @Get('models')
    async getModels(
        @Query('db') db: string,
        @Query('table') table: string,
        @Query('marka') marka: string
    ) {
        return this.calcService.getModels(db, table, marka);
    }

    @Get('estimate')
    async getEstimate(@Query() query: any) {
        const basePrice = await this.calcService.getBasePrice(
            query.db, query.table, query.marka, query.model, query.year
        );

        return this.calcService.calculateFullEstimate({
            auctionPrice: Number(query.auctionPrice),
            engineVolume: Number(query.engineVolume || 2000), // дефолт 2.0л
            year: Number(query.year),
            fuelType: query.fuelType || 'petrol',
            road: Number(query.road || 0),
            cert: Number(query.cert || 0),
            border: Number(query.border || 0),
            towing: Number(query.towing || 0),
        }, basePrice);
    }
}