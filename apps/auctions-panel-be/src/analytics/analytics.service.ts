import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class AnalyticsService {
    private readonly logger = new Logger(AnalyticsService.name);

    constructor(private readonly dbManager: ExternalDbManager) { }

    async getMarketAnalytics(dbName: string, vin: string) {
        if (!vin) throw new BadRequestException('VIN-код є обов’язковим для пошуку');

        const pool = await this.dbManager.getConnection(dbName);

        try {
            const [carRows]: any = await pool.query(`
                SELECT 
                    c.brand_id, 
                    c.model_id, 
                    c.chassis, 
                    c.price, 
                    c.mileage,
                    b.name as brand_name, 
                    m.name as model_name
                FROM cars c
                LEFT JOIN brands b ON c.brand_id = b.id
                LEFT JOIN models m ON c.model_id = m.id
                WHERE c.chassis = ?
                ORDER BY c.countdown DESC 
                LIMIT 1
            `, [vin]);

            if (!carRows || carRows.length === 0) {
                throw new NotFoundException(`Автомобіль з VIN ${vin} не знайдено`);
            }

            const targetCar = carRows[0];

            // 2. Формуємо $prices_list (усі авто цього бренду та моделі для побудови таблиці та графіків)
            // Поля точно відповідають вимогам таблиці: Тип, Авто, Пробіг, Перша реєстрація, Потужність, Ціна, Дата аукціону
            const [marketRows]: any = await pool.query(`
                SELECT 
                    c.id,
                    a.type as auction_type,
                    c.price,
                    c.mileage,
                    c.countdown as countdown_ts,
                    c.first_on_road as first_on_road_ts,
                    b.name as brand_name,
                    m.name as model_name,
                    c.eng_capacity,
                    c.transmission,
                    c.characteristics,
                    c.report,
                    c.photos,
                    c.chassis,
                    c.eng_power_hp,
                    c.eng_power_kw,
                    c.country_id
                FROM cars c
                LEFT JOIN brands b ON b.id = c.brand_id
                LEFT JOIN models m ON m.id = c.model_id
                LEFT JOIN auctions a ON a.id = c.auction_id
                WHERE c.brand_id = ? 
                  AND c.model_id = ? 
                  AND c.price > 0
                ORDER BY c.countdown DESC
            `, [targetCar.brand_id, targetCar.model_id]);

            // 3. Історія продажів саме цього VIN (для блоку "Блок продажів цього VIN" з .tpl)
            const vinSales = marketRows.filter(row => row.chassis === vin);

            return {
                targetCar: {
                    chassis: targetCar.chassis,
                    price: targetCar.price,
                    mileage: targetCar.mileage,
                    brand_name: targetCar.brand_name,
                    model_name: targetCar.model_name
                },
                vinSales,
                pricesList: marketRows // Цей масив замінить $prices_list на фронтенді
            };

        } catch (error) {
            this.logger.error(`Помилка аналітики для VIN ${vin}: ${error.message}`);
            if (error instanceof NotFoundException) throw error;
            throw new BadRequestException('Помилка завантаження аналітичних даних');
        }
    }

async getAuctionTypeAnalytics(dbName: string, vin: string) {
        if (!vin) throw new BadRequestException('VIN-код є обов’язковим для пошуку');
        const pool = await this.dbManager.getConnection(dbName);

        try {
            const [carRows]: any = await pool.query(
                'SELECT brand_id, model_id FROM cars WHERE chassis = ? LIMIT 1',
                [vin]
            );

            if (!carRows || carRows.length === 0) {
                throw new NotFoundException(`Автомобіль з VIN ${vin} не знайдено`);
            }

            const { brand_id, model_id } = carRows[0];

            // Працюємо виключно з таблицею cars (припускаємо, що поле називається auction_id або auction_type)
            // Якщо в базі колонка називається auction_id, заміни c.auction_type на c.auction_id
            const [auctionStats]: any = await pool.query(`
                SELECT 
                    c.auction_type,
                    COUNT(c.id) as total_cars,
                    ROUND(AVG(c.price), 0) as avg_price,
                    MIN(c.price) as min_price,
                    MAX(c.price) as max_price
                FROM cars c
                WHERE c.brand_id = ? 
                  AND c.model_id = ? 
                  AND c.price > 0
                GROUP BY c.auction_type
                ORDER BY total_cars DESC
            `, [brand_id, model_id]);

            return auctionStats;

        } catch (error) {
            this.logger.error(`Помилка аналітики аукціонів: ${error.message}`);
            throw new BadRequestException('Помилка завантаження даних по аукціонах');
        }
    }

    // НОВИЙ МЕТОД: Аналітика за країнами походження
    async getCountryAnalytics(dbName: string, vin: string) {
        if (!vin) throw new BadRequestException('VIN-код є обов’язковим для пошуку');
        const pool = await this.dbManager.getConnection(dbName);

        try {
            const [carRows]: any = await pool.query(
                'SELECT brand_id, model_id FROM cars WHERE chassis = ? LIMIT 1',
                [vin]
            );

            if (!carRows || carRows.length === 0) {
                throw new NotFoundException(`Автомобіль з VIN ${vin} не знайдено`);
            }

            const { brand_id, model_id } = carRows[0];

            // Забираємо JOIN, групуємо просто по country_id з таблиці cars
            const [countryStats]: any = await pool.query(`
                SELECT 
                    c.country_id,
                    COUNT(c.id) as total_cars,
                    ROUND(AVG(c.price), 0) as avg_price,
                    MIN(c.price) as min_price,
                    MAX(c.price) as max_price
                FROM cars c
                WHERE c.brand_id = ? 
                  AND c.model_id = ? 
                  AND c.price > 0
                  AND c.country_id IS NOT NULL
                GROUP BY c.country_id
                ORDER BY total_cars DESC
            `, [brand_id, model_id]);

            return countryStats;

        } catch (error) {
            this.logger.error(`Помилка аналітики країн: ${error.message}`);
            throw new BadRequestException('Помилка завантаження даних по країнах');
        }
    }
}