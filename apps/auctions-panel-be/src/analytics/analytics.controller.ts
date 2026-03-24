import { Controller, Get, Param, Query } from '@nestjs/common';
import { AnalyticsService } from './analytics.service';

@Controller('api/analytics')
export class AnalyticsController {
    constructor(private readonly analyticsService: AnalyticsService) { }

    @Get(':carId')
    async getAnalytics(
        @Param('carId') carId: number,
        @Query('dbName') dbName: string 
    ) {
        return await this.analyticsService.getCarAnalytics(dbName, carId);
    }
}