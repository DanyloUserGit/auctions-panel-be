import { Controller, Get, Query } from '@nestjs/common';
import { CalculationService } from './full_calculation.service';
import type { CustomsTableId } from './types';

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
        @Query('marka') marka: string,
    ) {
        return this.calcService.getModels(db, table, marka);
    }

    @Get('estimate')
    async getEstimate(@Query() query: any) {
        return this.calcService.estimate(query.db, query);
    }

    @Get('marka')
    async getRozrahunokBrands(@Query('db') db: string, @Query('table') table: string) {
        const brands = await this.calcService.getBrands(db, table);
        return { items: brands };
    }

    @Get('model')
    async getRozrahunokModels(
        @Query('db') db: string,
        @Query('table') table: string,
        @Query('marka') marka: string,
    ) {
        const models = await this.calcService.getModels(db, table, marka);
        return { items: models };
    }

    @Get('typ')
    async getRozrahunokTypes(
        @Query('db') db: string,
        @Query('table') table: string,
        @Query('marka') marka: string,
        @Query('model') model: string,
    ) {
        const types = await this.calcService.getTypes(db, table, marka, model);
        return { items: types };
    }

    @Get('years')
    async getRozrahunokYears(
        @Query('db') db: string,
        @Query('table') table: string,
        @Query('marka') marka: string,
        @Query('model') model: string,
        @Query('typ') typ: string,
    ) {
        const years = await this.calcService.getAvailableYears(
            db,
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
            query.db,
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
            query.db,
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
    async getTableMeta(@Query('db') db: string, @Query('table') table: CustomsTableId) {
        return this.calcService.getTableMeta(db, table);
    }

    @Get('table-rows')
    async getTableRows(
        @Query('db') db: string,
        @Query('table') table: CustomsTableId,
        @Query('qmarka') qmarka: string,
        @Query('qmodel') qmodel: string,
        @Query('qtyp') qtyp: string,
    ) {
        const rows = await this.calcService.getTableRows(db, table, { qmarka, qmodel, qtyp });
        return { rows };
    }

    @Get('sold-meta')
    async getSoldMeta(@Query('db') db: string, @Query('year') year: string) {
        return this.calcService.getSoldMeta(db, year);
    }

    @Get('sold-rows')
    async getSoldRows(
        @Query('db') db: string,
        @Query('q') q: string,
        @Query('year') year: string,
        @Query('months') months: string,
        @Query('sort') sort: string,
        @Query('dir') dir: 'ASC' | 'DESC',
        @Query('limit') limit: number,
        @Query('offset') offset: number,
    ) {
        const rows = await this.calcService.getSoldRows(db, { q, year, months, sort, dir, limit, offset });
        return { rows };
    }
}