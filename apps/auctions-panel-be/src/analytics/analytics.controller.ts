import { CLIENT_DB } from '../client-db/client-db.service';
import { Controller, Get, Param } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get('search/:vin')
    async getAnalyticsByVin(
        @Param('vin') vin: string
    ) {
        return await this.analyticsService.getMarketAnalytics(CLIENT_DB.main, vin);
    }

    @Get('search/:vin/auction-types')
    async getAuctionTypeAnalytics(
        @Param('vin') vin: string
    ) {
        return await this.analyticsService.getAuctionTypeAnalytics(CLIENT_DB.main, vin);
    }

    @Get('search/:vin/countries')
    async getCountryAnalytics(
        @Param('vin') vin: string
    ) {
        return await this.analyticsService.getCountryAnalytics(CLIENT_DB.main, vin);
    }
}