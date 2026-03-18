import { Injectable, BadRequestException } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

interface CalcParams {
    auctionPrice: number;
    engineVolume: number; 
    year: number;
    fuelType: 'petrol' | 'diesel';
    road?: number;
    cert?: number;
    border?: number;
    towing?: number;
}

@Injectable()
export class CalculationService {
    constructor(private dbManager: ExternalDbManager) { }

    private validateTable(table: string) {
        const allowed = ['27031', '27032', '27033'];
        if (!allowed.includes(table)) throw new BadRequestException('Невірна таблиця');
    }

    async getBrands(dbName: string, table: string): Promise<string[]> {
        const pool = await this.dbManager.getConnection(dbName);
        this.validateTable(table);
        const [rows]: any = await pool.execute(`SELECT DISTINCT marka FROM \`${table}\` ORDER BY marka ASC`);
        return rows.map((r: any) => r.marka);
    }

    async getModels(dbName: string, table: string, marka: string): Promise<string[]> {
        const pool = await this.dbManager.getConnection(dbName);
        this.validateTable(table);
        const [rows]: any = await pool.execute(
            `SELECT DISTINCT model FROM \`${table}\` WHERE marka = ? ORDER BY model ASC`,
            [marka]
        );
        return rows.map((r: any) => r.model);
    }

    async getBasePrice(dbName: string, table: string, marka: string, model: string, year: string): Promise<number> {
        const pool = await this.dbManager.getConnection(dbName);
        this.validateTable(table);
        const sql = `SELECT \`${year}\` as price FROM \`${table}\` WHERE marka = ? AND model = ? LIMIT 1`;
        const [rows]: any = await pool.execute(sql, [marka, model]);
        return rows[0]?.price || 0;
    }

    /**
     * Повна формула розмитнення (згідно з законодавством України, яке зазвичай в .tpl)
     */
    calculateFullEstimate(params: CalcParams, basePriceFromDb: number) {
        const { auctionPrice, engineVolume, year, fuelType } = params;
        const currentYear = new Date().getFullYear();

        // 1. Ввізне мито (зазвичай 10% від вартості)
        const importDuty = auctionPrice * 0.10;

        // 2. Акциз
        // Базова ставка: бензин до 3л = 50 євро, бензин понад 3л = 100 євро
        // Дизель до 3.5л = 75 євро, понад 3.5л = 150 євро
        let baseRate = fuelType === 'petrol' ? (engineVolume <= 3000 ? 50 : 100) : (engineVolume <= 3500 ? 75 : 150);
        let age = currentYear - year - 1;
        if (age <= 0) age = 1;
        if (age > 15) age = 15;

        const excise = baseRate * (engineVolume / 1000) * age;

        // 3. ПДВ (20% від суми: ціна + мито + акциз)
        const vat = (Number(auctionPrice) + importDuty + excise) * 0.20;

        const totalCustoms = importDuty + excise + vat;
        const serviceFee = 500; // Твоя фіксована комісія

        const totalInUkraine =
            Number(auctionPrice) +
            totalCustoms +
            serviceFee +
            (params.road || 0) +
            (params.cert || 0) +
            (params.border || 0) +
            (params.towing || 0);

        return {
            basePriceFromDb,
            details: {
                importDuty: Math.round(importDuty),
                excise: Math.round(excise),
                vat: Math.round(vat),
                totalCustoms: Math.round(totalCustoms),
            },
            serviceFee,
            totalInUkraine: Math.round(totalInUkraine),
        };
    }
}