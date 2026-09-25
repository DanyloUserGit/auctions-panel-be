import { Controller, Get, Query, Req } from '@nestjs/common';
import { CrmScopeService } from '../client-db/crm-scope.service';
import { BalanceService } from './balance.service';

@Controller('balance')
export class BalanceController {
    constructor(
        private readonly balanceService: BalanceService,
        private readonly scope: CrmScopeService,
    ) { }

    @Get('clients')
    async getClients(@Req() req) {
        return this.balanceService.getClients(await this.scope.clientNames(req.user));
    }

    @Get('data')
    async getBalances(@Req() req, @Query('client') client: string, @Query('asof') asof?: string) {
        return this.balanceService.getBalances(await this.scope.clientNames(req.user), client, asof);
    }
}
