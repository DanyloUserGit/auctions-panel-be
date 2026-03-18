import { Controller, Get, Query } from '@nestjs/common';
import { BalanceService } from './balance.service';

@Controller('balance')
export class BalanceController {
    constructor(private readonly balanceService: BalanceService) { }

    @Get('clients')
    async getClients(@Query('db') db: string) {
        return this.balanceService.getClients(db);
    }

    @Get('data')
    async getBalances(@Query('db') db: string, @Query('client') client: string) {
        return this.balanceService.getBalances(db, client);
    }
}