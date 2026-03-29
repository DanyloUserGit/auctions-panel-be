import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class WonCarsService {
    constructor(private readonly dbManager: ExternalDbManager) { }

    async getWonCarsData(dbName: string, userId: number, isAdmin: boolean, limit = 20, offset = 0) {
        const pool = await this.dbManager.getConnection(dbName);

        let whereClause = 'c.status > 1';
        const params: any[] = [];

        if (!isAdmin) {
            whereClause += ' AND c.won_user_id = ?';
            params.push(userId);
        }

        // 1. Отримання списку авто
        const carsQuery = `
      SELECT 
        c.id, c.status, c.item_number, c.price, c.characteristics, 
        c.fuel, c.eng_power_hp, c.eng_power_kw, c.eng_capacity,
        c.first_on_road, c.transmission, c.location, c.mileage, 
        
        c.photos, /* ДОДАНО: Колонка з фото. Якщо у вас вона називається інакше (напр. photo або image), змініть тут */

        b.name as brand, m.name as model, ct.code as country_code,
        a.site_id, a.type as auction_type, a.name as auction_name,
        (SELECT MAX(rate) FROM bets WHERE car_id = c.id) as max_bet
      FROM cars c 
      LEFT JOIN brands b ON b.id = c.brand_id 
      LEFT JOIN models m ON m.id = c.model_id 
      LEFT JOIN countries ct ON ct.id = c.country_id
      LEFT JOIN auctions a ON a.id = c.auction_id
      LEFT JOIN users u ON u.id = c.won_user_id
      WHERE ${whereClause}
      ORDER BY c.countdown DESC, c.id ASC
      LIMIT ? OFFSET ?
    `;

        const statsQuery = `
      SELECT 
        COUNT(*) as total_count,
        SUM(CASE WHEN c.status = 3 THEN 1 ELSE 0 END) as distributed_count,
        SUM(CASE WHEN c.status = 3 THEN (SELECT MAX(rate) FROM bets WHERE car_id = c.id) ELSE 0 END) as distributed_amount,
        SUM((SELECT MAX(rate) FROM bets WHERE car_id = c.id)) as total_amount,
        SUM(CASE WHEN c.status = 2 THEN (SELECT MAX(rate) FROM bets WHERE car_id = c.id) ELSE 0 END) as notdistributed_amount
      FROM cars c
      LEFT JOIN users u ON u.id = c.won_user_id
      WHERE ${whereClause}
    `;

        const [carsResult, statsResult] = await Promise.all([
            pool.execute(carsQuery, [...params, limit.toString(), offset.toString()]),
            pool.execute(statsQuery, params)
        ]);

        // 3. Логіка парсингу картинки
        const cars = (carsResult[0] as any[]).map(car => {
            let imageUrl = '/images/no-photo.jpg'; // Заглушка, якщо фото немає взагалі

            if (car.photos) {
                try {
                    // Якщо фото збережено як JSON (наприклад: ["img1.jpg", "img2.jpg"])
                    const parsedPhotos = JSON.parse(car.photos);
                    if (Array.isArray(parsedPhotos) && parsedPhotos.length > 0) {
                        // Змініть '/uploads/cars/' на ваш реальний шлях до папки з картинками
                        imageUrl = `${parsedPhotos[0]}`;
                    }
                } catch (e) {
                    // Якщо фото збережено як звичайний рядок (наприклад: "main.jpg" або "img1.jpg,img2.jpg")
                    const firstPhoto = car.photos.split(',')[0];

                    if (firstPhoto.startsWith('http')) {
                        imageUrl = firstPhoto; // Якщо в базі вже лежить повне посилання
                    } else {
                        imageUrl = `/uploads/cars/${car.id}/${firstPhoto}`; // Якщо лежить тільки назва файлу
                    }
                }
            }

            return {
                ...car,
                image: imageUrl
            };
        });

        return {
            cars,
            stats: statsResult[0][0]
        };
    }

    async updateCarStatus(dbName: string, carId: number, status: number, isAdmin: boolean) {
        if (!isAdmin) {
            throw new ForbiddenException('Тільки адміністратор може змінювати статус автомобіля');
        }

        if (![2, 3, 4].includes(status)) {
            throw new BadRequestException('Недопустиме значення статусу');
        }

        const pool = await this.dbManager.getConnection(dbName);
        const updateQuery = `UPDATE cars SET status = ? WHERE id = ?`;
        const [result] = await pool.execute(updateQuery, [status, carId]);

        if ((result as any).affectedRows === 0) {
            throw new NotFoundException('Автомобіль не знайдено');
        }

        return { success: true, message: 'Статус успішно оновлено', carId, status };
    }
}