import { BadRequestException, Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class InStockService {
    private readonly logger = new Logger(InStockService.name);

    constructor(private readonly dbManager: ExternalDbManager) { }

    async getInStockCars(dbName: string) {
        try {
            // Отримуємо з'єднання для конкретного клієнта/БД
            const pool = await this.dbManager.getConnection(dbName);

            // Запит базується на логіці з PHP функції cars_sale()
            const query = `
        SELECT 
            c.id,
            c.price,
            c.fuel,
            c.eng_capacity,
            c.first_on_road,
            c.transmission,
            c.mileage,
            c.location,
            c.photos,
            c.chassis,
            c.status,
            b.name as brand,
            m.name as model
        FROM cars_for_sale c 
        LEFT JOIN brands b ON b.id=c.brand_id 
        LEFT JOIN models m ON m.id=c.model_id
        ORDER BY c.id DESC
      `;

            const [rows] = await pool.query(query);

            // Мапінг результатів під інтерфейс Car з InStock.tsx
            return (rows as any[]).map(row => {
                // Отримання головного фото (як у PHP: explode(',', $row['photos'])[0])
                const photos = row.photos ? row.photos.split(',') : [];
                const imageUrl = photos.length > 0 && photos[0].trim() !== ''
                    ? photos[0].trim()
                    : 'https://via.placeholder.com/400x250?text=No+Image';

                // Витягуємо рік з first_on_road (передбачається, що це UNIX timestamp або дата)
                const year = row.first_on_road
                    ? new Date(row.first_on_road * 1000).getFullYear()
                    : new Date().getFullYear();

                // Мапінг статусів (у PHP статус 0 зазвичай "доступний")
                let status = 'available';
                if (row.status === 1) status = 'reserved';
                if (row.status === 2) status = 'sold';

                return {
                    id: row.id,
                    brand: row.brand || 'Невідомо',
                    model: row.model || 'Невідомо',
                    year: year,
                    mileage: row.mileage || 0,
                    // Раніше тут конкатенувалося eng_capacity + fuel при кожному читанні,
                    // а весь рядок зберігався назад у fuel при кожному редагуванні -
                    // це й спричиняло дублювання об'єму двигуна. Тепер fuel зберігає
                    // повний текст "двигуна" як єдине джерело правди.
                    engine: (row.fuel || '').trim(),
                    transmission: row.transmission || 'Не вказано',
                    price: row.price || 0,
                    chassis: row.chassis || '',
                    imageUrl: imageUrl,
                    status: status,
                    location: row.location || 'Не вказано',
                };
            });
        } catch (error) {
            this.logger.error(`Помилка отримання автомобілів: ${(error as Error).message}`);
            throw new InternalServerErrorException('Не вдалося завантажити список автомобілів');
        }
    }
    async createCar(dbName: string, carData: any) {
        try {
            // Базова валідація: не дозволяємо створити "порожнє" авто
            if (!carData.brand || !carData.model || !carData.price || Number(carData.price) <= 0) {
                throw new BadRequestException('Заповніть обов\'язкові поля: марка, модель, ціна');
            }
            // Нове авто не може одразу мати статус "продано"
            if (carData.status === 'sold') {
                throw new BadRequestException('Неможливо створити нове авто зі статусом "Продано"');
            }

            const pool = await this.dbManager.getConnection(dbName);

            let statusNum = 0;
            if (carData.status === 'reserved') statusNum = 1;
            if (carData.status === 'sold') statusNum = 2;

            const firstOnRoad = carData.year ? new Date(carData.year, 0, 1).getTime() / 1000 : 0;

            // Жорстке обмеження для трансмісії
            const transmission = ['Automatic', 'Mechanic'].includes(carData.transmission)
                ? carData.transmission
                : 'Automatic';

            // Додали fuel (куди записуємо engine)
            const query = `
            INSERT INTO cars_for_sale 
            (brand_id, model_id, price, transmission, fuel, mileage, chassis, status, first_on_road, photos, location, auction_id) 
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `;

            const [result] = await pool.query(query, [
                carData.brand_id || 1,
                carData.model_id || 1,
                carData.price || 0,
                transmission,          // Оновлено
                carData.engine || '',  // Зберігаємо engine в колонку fuel
                carData.mileage || 0,
                carData.chassis || '',
                statusNum,
                firstOnRoad,
                carData.imageUrl || '',
                carData.location || '',
                0
            ]);

            return { success: true, insertId: (result as any).insertId };
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            this.logger.error(`Помилка створення авто: ${(error as Error).message}`);
            throw new InternalServerErrorException('Не вдалося створити авто');
        }
    }

    async updateCar(dbName: string, id: number, carData: any) {
        try {
            // Базова валідація: не дозволяємо зберегти "порожнє" авто
            if (!carData.brand || !carData.model || !carData.price || Number(carData.price) <= 0) {
                throw new BadRequestException('Заповніть обов\'язкові поля: марка, модель, ціна');
            }

            const pool = await this.dbManager.getConnection(dbName);

            let statusNum = 0;
            if (carData.status === 'reserved') statusNum = 1;
            if (carData.status === 'sold') statusNum = 2;

            const firstOnRoad = carData.year ? new Date(carData.year, 0, 1).getTime() / 1000 : 0;

            const transmission = ['Automatic', 'Mechanic'].includes(carData.transmission)
                ? carData.transmission
                : 'Automatic';

            // Додали оновлення fuel
            const query = `
            UPDATE cars_for_sale 
            SET price = ?, transmission = ?, fuel = ?, mileage = ?, chassis = ?, status = ?, first_on_road = ?, photos = ?
            WHERE id = ?
        `;

            await pool.query(query, [
                carData.price,
                transmission,         // Оновлено
                carData.engine || '', // Оновлено
                carData.mileage,
                carData.chassis,
                statusNum,
                firstOnRoad,
                carData.imageUrl,
                id
            ]);

            return { success: true };
        } catch (error) {
            if (error instanceof BadRequestException) throw error;
            this.logger.error(`Помилка оновлення авто: ${(error as Error).message}`);
            throw new InternalServerErrorException('Не вдалося оновити авто');
        }
    }
}