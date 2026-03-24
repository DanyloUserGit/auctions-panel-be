import { Injectable, NotFoundException } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class AnalyticsService {
    constructor(private readonly dbManager: ExternalDbManager) { }

    async getCarAnalytics(dbName: string, carId: number) {
        const pool = await this.dbManager.getConnection(dbName);

        // 1. Отримуємо дані по нашому авто
        const [carRows]: any = await pool.query(
            `SELECT id, brand_id, model_id, fuel, transmission, eng_power_kw, eng_capacity, mileage, first_on_road, price 
             FROM cars WHERE id = ?`,
            [carId]
        );

        if (!carRows || carRows.length === 0) {
            throw new NotFoundException('Автомобіль не знайдено');
        }

        const car = carRows[0];
        const carYear = this.extractMarketYear(car.first_on_road);

        // 2. Отримуємо "пул" аналогів з бази
        const [poolRows]: any = await pool.query(
            `SELECT id, brand_id, model_id, fuel, transmission, eng_power_kw, eng_capacity, mileage, first_on_road, price, chassis
             FROM cars 
             WHERE brand_id = ? AND model_id = ? AND price > 0`,
            [car.brand_id, car.model_id]
        );

        let rawRows = this.deduplicateMarketRows(poolRows);

        // 3. Фільтруємо пул за етапами (stage)
        const stage = { kw_tolerance: 10, capacity_tolerance: 200, max_mileage_diff: 50000 };
        const filteredRows = this.filterMarketPoolByStage(car, rawRows, stage);

        if (filteredRows.length < 3) {
            return { market_has_analytics: false, market_count: 0 };
        }

        const rawCount = filteredRows.length;

        // 4. Видаляємо аномальні ціни (викиди)
        const { clean_rows, removed_rows } = this.detectAndTrimOutliers(filteredRows);

        let validRows: any[] = clean_rows;
        if (validRows.length < 6) {
            validRows = filteredRows;
        }

        validRows.sort((a, b) => Number(a.price) - Number(b.price));
        const prices = validRows.map(r => Number(r.price));
        const count = prices.length;

        if (count < 3) {
            return { market_has_analytics: false, market_count: 0 };
        }

        // 5. Розрахунок маркерів ринку
        const p20 = this.percentileValue(prices, 0.20);
        const p25 = this.percentileValue(prices, 0.25);
        const median = this.percentileValue(prices, 0.50);
        const p75 = this.percentileValue(prices, 0.75);
        const p80 = this.percentileValue(prices, 0.80);
        const min = prices[0];
        const max = prices[count - 1];
        const avg = prices.reduce((a, b) => a + b, 0) / count;

        const marketFloor = p20;

        // 6. Розрахунок прогнозованої ціни по пробігу
        const predictedPriceByMileage = this.getPredictedPriceByMileage(validRows, car.mileage, car);

        const carPrice = Number(car.price);

        // Явне вказування типів (number | null) замість неявного null
        let diffPct: number | null = null;
        let zone = 0;
        let zoneLabel = 'Невідомо';
        let zoneColor = '#9ca3af';

        if (median !== null && median > 0 && carPrice > 0) {
            diffPct = ((carPrice - median) / median) * 100;

            // Перевіряємо, що p25 і p75 не є null перед порівнянням
            if (p25 !== null && carPrice <= p25) {
                zone = 1; zoneLabel = 'Низ ринку'; zoneColor = '#16a34a'; // зелений
            } else if (carPrice <= median) {
                zone = 2; zoneLabel = 'Нижче медіани'; zoneColor = '#ca8a04'; // жовтий
            } else if (p75 !== null && carPrice <= p75) {
                zone = 3; zoneLabel = 'Вище медіани'; zoneColor = '#f97316'; // оранжевий
            } else {
                zone = 4; zoneLabel = 'Верх ринку'; zoneColor = '#dc2626'; // червоний
            }
        }

        // Явне вказування типів (number | null)
        let vsPredictedDiff: number | null = null;
        let vsPredictedDiffPct: number | null = null;

        if (predictedPriceByMileage !== null && predictedPriceByMileage > 0 && carPrice > 0) {
            vsPredictedDiff = carPrice - predictedPriceByMileage;
            vsPredictedDiffPct = (vsPredictedDiff / predictedPriceByMileage) * 100;
        }

        return {
            carId: car.id,
            market_has_analytics: true,
            market_count: count,
            market_count_raw: rawCount,
            market_outliers_removed: removed_rows.length,
            market_floor: marketFloor,
            market_min: min,
            market_p25: p25,
            market_median: median,
            market_p75: p75,
            market_max: max,
            market_avg: avg,
            market_zone: zone,
            market_zone_label: zoneLabel,
            market_zone_color: zoneColor,
            market_diff_pct: diffPct,
            market_predicted_price_by_mileage: predictedPriceByMileage,
            market_vs_predicted_diff: vsPredictedDiff,
            market_vs_predicted_diff_pct: vsPredictedDiffPct,
            current_display_price: carPrice
        };
    }

    // --- ДОПОМІЖНІ ФУНКЦІЇ ---

    private percentileValue(values: number[], p: number): number | null {
        if (!values || values.length === 0) return null;
        const sorted = [...values].sort((a, b) => a - b);
        const count = sorted.length;
        if (count === 1) return sorted[0];

        const index = (count - 1) * p;
        const low = Math.floor(index);
        const high = Math.ceil(index);

        if (low === high) return sorted[low];

        const weight = index - low;
        return sorted[low] + (sorted[high] - sorted[low]) * weight;
    }

    private normalizeTransmissionForMarket(value: string): string {
        const val = (value || '').trim().toLowerCase();
        if (val === '') return '';
        if (val.includes('auto') || val.includes('dct') || val.includes('cvt') || val.includes('bva')) return 'automatic';
        if (val.includes('man') || val.includes('mech')) return 'manual';
        return val;
    }

    private normalizeFuelForMarket(value: string): string {
        const val = (value || '').trim().toLowerCase();
        if (val === '') return '';
        if (val.includes('electric') || val.includes('bev')) return 'electric';
        if (val.includes('hybrid/diesel') || val.includes('mhev diesel') || val.includes('hev diesel')) return 'hybrid_diesel';
        if (val.includes('hybrid') || val.includes('phev') || val.includes('mhev') || val.includes('hev')) return 'hybrid_gasoline';
        if (val.includes('diesel') || val.includes('crdi') || val.includes('tdi') || val.includes('dci')) return 'diesel';
        if (val.includes('gasoline') || val.includes('petrol') || val.includes('benz') || val.includes('t-gdi') || val.includes('gdi')) return 'gasoline';
        return val;
    }

    private extractMarketYear(timestamp: number | string): number {
        const ts = Number(timestamp);
        if (ts <= 0) return 0;
        const year = new Date(ts * 1000).getFullYear();
        return (year >= 1990 && year <= 2100) ? year : 0;
    }

    private makeMarketFingerprint(row: any): string {
        if (row.chassis && String(row.chassis).trim() !== '') {
            return 'vin:' + String(row.chassis).trim();
        }
        const parts = [
            Number(row.brand_id) || 0,
            Number(row.model_id) || 0,
            Number(row.eng_power_kw) || 0,
            Number(row.eng_capacity) || 0,
            Number(row.mileage) || 0,
            Math.round(Number(row.price)) || 0,
            Number(row.first_on_road) || 0,
        ];
        return 'fp:' + parts.join('|');
    }

    private deduplicateMarketRows(rows: any[]): any[] {
        if (!rows || rows.length === 0) return [];
        const unique = new Map<string, any>();
        for (const row of rows) {
            const key = this.makeMarketFingerprint(row);
            if (!unique.has(key)) {
                unique.set(key, row);
            }
        }
        return Array.from(unique.values());
    }

    private filterMarketPoolByStage(car: any, pool: any[], stage: any): any[] {
        const carFuel = this.normalizeFuelForMarket(car.fuel);
        const carTrans = this.normalizeTransmissionForMarket(car.transmission);
        const carKw = Number(car.eng_power_kw) || 0;
        const carYear = this.extractMarketYear(car.first_on_road);

        return pool.filter(row => {
            const rowFuel = this.normalizeFuelForMarket(row.fuel);
            const rowTrans = this.normalizeTransmissionForMarket(row.transmission);
            const rowKw = Number(row.eng_power_kw) || 0;
            const rowYear = this.extractMarketYear(row.first_on_road);

            if (carYear > 0 && rowYear > 0 && Math.abs(rowYear - carYear) > 1) return false;
            if (carFuel && rowFuel && carFuel !== rowFuel) return false;
            if (carTrans && rowTrans && carTrans !== rowTrans) return false;
            if (carKw > 0 && rowKw > 0 && Math.abs(rowKw - carKw) > stage.kw_tolerance) return false;

            return true;
        });
    }

    private detectAndTrimOutliers(rows: any[]) {
        if (!rows || rows.length === 0) return { clean_rows: [], removed_rows: [] };

        const prices = rows.map(r => Number(r.price)).sort((a, b) => a - b);
        const q1 = this.percentileValue(prices, 0.25) || 0;
        const q3 = this.percentileValue(prices, 0.75) || 0;
        const iqr = q3 - q1;

        const lowBound = q1 - 1.5 * iqr;
        const highBound = q3 + 1.5 * iqr;

        // Вказуємо тип any[] для масивів
        const clean_rows: any[] = [];
        const removed_rows: any[] = [];

        for (const row of rows) {
            const price = Number(row.price);
            if (price >= lowBound && price <= highBound) {
                clean_rows.push(row);
            } else {
                removed_rows.push(row);
            }
        }

        return { clean_rows, removed_rows };
    }

    private getPredictedPriceByMileage(rows: any[], targetMileage: number, car: any): number | null {
        targetMileage = Number(targetMileage);
        if (targetMileage <= 0 || !rows || rows.length === 0) return null;

        // Явно вказуємо інтерфейс масиву
        const candidates: Array<{ price: number; mileage: number; mileage_diff: number; distance: number }> = [];

        for (const row of rows) {
            const price = Number(row.price);
            const mileage = Number(row.mileage);
            if (price <= 0 || mileage <= 0) continue;

            candidates.push({
                price: price,
                mileage: mileage,
                mileage_diff: Math.abs(mileage - targetMileage),
                distance: Math.abs(mileage - targetMileage) / 1000
            });
        }

        candidates.sort((a, b) => a.mileage_diff - b.mileage_diff);

        const selected = candidates.slice(0, 15);
        if (selected.length < 3) return null;

        // Явно вказуємо інтерфейс масиву
        const points: Array<{ price: number; weight: number }> = [];

        for (const candidate of selected) {
            let weight = 1 / Math.max(1, candidate.distance);
            if (candidate.mileage_diff <= 15000) weight *= 1.35;
            else if (candidate.mileage_diff <= 30000) weight *= 1.20;
            else if (candidate.mileage_diff <= 50000) weight *= 1.05;

            points.push({ price: candidate.price, weight: weight });
        }

        points.sort((a, b) => a.price - b.price);
        const weightTotal = points.reduce((sum, p) => sum + p.weight, 0);

        let cumulativeWeight = 0;
        let weightedMedian = points[0].price;

        for (const point of points) {
            cumulativeWeight += point.weight;
            if (cumulativeWeight >= weightTotal / 2) {
                weightedMedian = point.price;
                break;
            }
        }

        return Math.round(weightedMedian);
    }
}