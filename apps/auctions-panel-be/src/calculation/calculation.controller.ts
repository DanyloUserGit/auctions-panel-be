import { CLIENT_DB } from '../client-db/client-db.service';
import { FileInterceptor } from '@nestjs/platform-express';
import { Roles } from '@prisma/client';
import { Audit } from '../audit-log/audit.decorator';
import { RolesGuard } from '../auth/roles.guard';
import { RolesDecorator } from '../decorators/roles.decorator';
import { Controller, Get, Query, Body, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { CalculationService } from './full_calculation.service';
import type { CustomsTableId } from './types';

@Controller('calc')
export class CalculationController {
    constructor(private readonly calcService: CalculationService) { }

    @Get('brands')
    async getBrands(@Query('table') table: string) {
        return this.calcService.getBrands(CLIENT_DB.crm, table);
    }

    @Get('models')
    async getModels(
        @Query('table') table: string,
        @Query('marka') marka: string,
    ) {
        return this.calcService.getModels(CLIENT_DB.crm, table, marka);
    }

    @Get('estimate')
    async getEstimate(@Query() query: any) {
        return this.calcService.estimate(CLIENT_DB.crm, query);
    }

    @Get('marka')
    async getRozrahunokBrands(@Query('table') table: string) {
        const brands = await this.calcService.getBrands(CLIENT_DB.crm, table);
        return { items: brands };
    }

    @Get('model')
    async getRozrahunokModels(
        @Query('table') table: string,
        @Query('marka') marka: string,
    ) {
        const models = await this.calcService.getModels(CLIENT_DB.crm, table, marka);
        return { items: models };
    }

    @Get('typ')
    async getRozrahunokTypes(
        @Query('table') table: string,
        @Query('marka') marka: string,
        @Query('model') model: string,
    ) {
        const types = await this.calcService.getTypes(CLIENT_DB.crm, table, marka, model);
        return { items: types };
    }

    @Get('years')
    async getRozrahunokYears(
        @Query('table') table: string,
        @Query('marka') marka: string,
        @Query('model') model: string,
        @Query('typ') typ: string,
    ) {
        const years = await this.calcService.getAvailableYears(
            CLIENT_DB.crm,
            table,
            marka,
            model,
            typ
        );

        return { items: years };
    }

    @Get('price')
    async getRozrahunokPrice(@Query() query: any) {
        const price = await this.calcService.getBasePrice(
            CLIENT_DB.crm,
            query.table,
            query.marka,
            query.model,
            query.year,
            // query.typ, // додано typ, бо він є в api.ts
        );
        return {
            found: price !== null && price !== undefined,
            price: price,
        };
    }

    @Get('rozrahunok-estimate')
    async getRozrahunokEstimate(@Query() query: any) {
        const basePriceFromDb = await this.calcService.getPriceBySelection(
            CLIENT_DB.crm,
            query.table,
            query.marka,
            query.model,
            query.typ,
            query.year,
        );

        return this.calcService.calculateFullEstimate({
            table: query.table,

            basePriceFromDb: basePriceFromDb ?? 0,
            deliveryCost: Number(query.delivery || 0),

            eurToUsd: Number(query.fx),

            engineVolume: query.table !== '27033' ? Number(query.param) : undefined,
            batteryCapacity: query.table === '27033' ? Number(query.param) : undefined,

            year: Number(query.year),

            fuelType:
                query.table === '27033'
                    ? 'electric'
                    : query.typ?.toLowerCase().includes('diesel')
                        ? 'diesel'
                        : 'petrol',

            road: Number(query.road || 0),
            cert: Number(query.cert || 0),
            border: Number(query.border || 0),
            towing: Number(query.towing || 0),
        });
    }

    @Get('table-meta')
    async getTableMeta(@Query('table') table: CustomsTableId) {
        return this.calcService.getTableMeta(CLIENT_DB.crm, table);
    }

    @Get('table-rows')
    async getTableRows(
        @Query('table') table: CustomsTableId,
        @Query('qmarka') qmarka: string,
        @Query('qmodel') qmodel: string,
        @Query('qtyp') qtyp: string,
    ) {
        const rows = await this.calcService.getTableRows(CLIENT_DB.crm, table, { qmarka, qmodel, qtyp });
        return { rows };
    }

    @Get('sold-meta')
    async getSoldMeta(@Query('year') year: string) {
        return this.calcService.getSoldMeta(CLIENT_DB.crm, year);
    }

    @Get('sold-rows')
    async getSoldRows(
        @Query('q') q: string,
        @Query('year') year: string,
        @Query('months') months: string,
        @Query('sort') sort: string,
        @Query('dir') dir: 'ASC' | 'DESC',
        @Query('limit') limit: number,
        @Query('offset') offset: number,
    ) {
        const rows = await this.calcService.getSoldRows(CLIENT_DB.crm, { q, year, months, sort, dir, limit, offset });
        return { rows };
    }

    // Імпорт «Проданих авто» з CSV (ТЗ 13.4) з опцією «Оновлювати існуючі записи».
    @UseGuards(RolesGuard)
    @RolesDecorator(Roles.SuperAdmin, Roles.Admin)
    @Audit('calc.sold.import', 'Імпорт проданих авто з CSV')
    @Post('sold-import')
    @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024 } }))
    importSold(@UploadedFile() file: Express.Multer.File, @Body('updateExisting') updateExisting?: string) {
        return this.calcService.importSoldCsv(CLIENT_DB.crm, file, { updateExisting: updateExisting === 'true' || updateExisting === '1' });
    }
}
