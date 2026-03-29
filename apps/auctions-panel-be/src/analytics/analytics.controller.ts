import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('search/:vin')
    async getAnalyticsByVin(
        @Param('vin') vin: string,
        @Query('dbName') dbName: string
    ) {
        return await this.analyticsService.getMarketAnalytics(dbName, vin);
    }

    @Get('search/:vin/auction-types')
    async getAuctionTypeAnalytics(
        @Param('vin') vin: string,
        @Query('dbName') dbName: string
    ) {
        return await this.analyticsService.getAuctionTypeAnalytics(dbName, vin);
    }

    @Get('search/:vin/countries')
    async getCountryAnalytics(
        @Param('vin') vin: string,
        @Query('dbName') dbName: string
    ) {
        return await this.analyticsService.getCountryAnalytics(dbName, vin);
    }
}