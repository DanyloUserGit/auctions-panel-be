import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Roles } from '@prisma/client';
import { CLIENT_DB, ExternalDbManager } from '../client-db/client-db.service';
import { CrmScopeService, type CrmUser } from '../client-db/crm-scope.service';
import { PrismaService } from '../prisma/prisma.service';

// Фото авто в базі замовника: JSON-масив, рядок через кому або назва файлу.
export function parseCarPhotos(carId: number, photos: string | null): string[] {
    if (!photos) return [];
    try {
        const parsed = JSON.parse(photos);
        if (Array.isArray(parsed)) return parsed.map(String).filter(Boolean);
    } catch {
        /* не JSON */
    }
    return photos
        .split(',')
        .map((p) => p.trim())
        .filter(Boolean)
        .map((p) => (p.startsWith('http') ? p : `/uploads/cars/${carId}/${p}`));
}

// «Покупки» (ТЗ 13.2): виграні / куплені авто. Покупець у базі замовника (cars.won_user_id → users)
// зіставляється з користувачем платформи за email: User бачить свої покупки, GA - покупки учасників
// своєї групи, SuperAdmin - усі.
@Injectable()
export class WonCarsService {
    constructor(
        private readonly dbManager: ExternalDbManager,
        private readonly scope: CrmScopeService,
        private readonly prisma: PrismaService,
    ) { }

    private pool() {
        return this.dbManager.getConnection(CLIENT_DB.main);
    }

    // ID покупців у базі замовника, чиї покупки бачить користувач (null - усі).
    private async buyerIds(user: CrmUser): Promise<number[] | null> {
        const owners = await this.scope.ownerIds(user);
        if (owners === null) return null;

        const users = await this.prisma.user.findMany({ where: { id: { in: owners } }, select: { email: true } });
        const emails = users.map((u) => u.email.toLowerCase());
        if (emails.length === 0) return [];

        const pool = await this.pool();
        const [rows]: any = await pool.query(
            `SELECT id FROM users WHERE LOWER(email) IN (${emails.map(() => '?').join(', ')})`,
            emails,
        );
        return rows.map((r: { id: number }) => r.id);
    }

    private async scopeClause(user: CrmUser) {
        const ids = await this.buyerIds(user);
        if (ids === null) return { clause: '', params: [] as number[] };
        if (ids.length === 0) return { clause: ' AND 1 = 0', params: [] as number[] };
        return { clause: ` AND c.won_user_id IN (${ids.map(() => '?').join(', ')})`, params: ids };
    }

    async getWonCarsData(user: CrmUser, limit = 20, offset = 0) {
        const pool = await this.pool();
        const scope = await this.scopeClause(user);
        const whereClause = `c.status > 1${scope.clause}`;

        const carsQuery = `
      SELECT
        c.id, c.status, c.item_number, c.price, c.characteristics,
        c.fuel, c.eng_power_hp, c.eng_power_kw, c.eng_capacity,
        c.first_on_road, c.transmission, c.location, c.mileage, c.chassis, c.photos,
        b.name as brand, m.name as model, ct.code as country_code,
        a.site_id, a.type as auction_type, a.name as auction_name,
        (SELECT MAX(rate) FROM bets WHERE car_id = c.id) as max_bet
      FROM cars c
      LEFT JOIN brands b ON b.id = c.brand_id
      LEFT JOIN models m ON m.id = c.model_id
      LEFT JOIN countries ct ON ct.id = c.country_id
      LEFT JOIN auctions a ON a.id = c.auction_id
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
      WHERE ${whereClause}
    `;

        const [carsResult, statsResult] = await Promise.all([
            pool.query(carsQuery, [...scope.params, limit, offset]),
            pool.query(statsQuery, scope.params),
        ]);

        const cars = (carsResult[0] as any[]).map(({ photos, ...car }) => {
            const list = parseCarPhotos(car.id, photos);
            return { ...car, photos: list, image: list[0] ?? '/images/no-photo.jpg' };
        });

        return { cars, stats: (statsResult[0] as any[])[0] };
    }

    // Дані виграного авто для виставлення на продаж у «В наявності» (лише в межах видимості користувача).
    async getWonCar(user: CrmUser, carId: number) {
        const pool = await this.pool();
        const scope = await this.scopeClause(user);
        const [rows]: any = await pool.query(
            `SELECT c.id, c.brand_id, c.model_id, c.price, c.fuel, c.eng_capacity, c.first_on_road, c.transmission,
                    c.mileage, c.chassis, c.location, c.photos, b.name as brand, m.name as model
             FROM cars c
             LEFT JOIN brands b ON b.id = c.brand_id
             LEFT JOIN models m ON m.id = c.model_id
             WHERE c.id = ? AND c.status > 1${scope.clause}`,
            [carId, ...scope.params],
        );
        const car = rows?.[0];
        if (!car) throw new NotFoundException('Покупку не знайдено');

        return {
            id: car.id,
            brandId: car.brand_id,
            modelId: car.model_id,
            brand: car.brand,
            model: car.model,
            year: car.first_on_road ? new Date(car.first_on_road * 1000).getFullYear() : null,
            mileage: car.mileage || 0,
            engine: [car.eng_capacity ? `${(car.eng_capacity / 1000).toFixed(1)}` : '', car.fuel || ''].join(' ').trim(),
            // У формі «В наявності» - лише Automatic / Mechanic.
            transmission: /mech|manual|мех/i.test(car.transmission || '') ? 'Mechanic' : 'Automatic',
            chassis: car.chassis || '',
            location: car.location || '',
            price: car.price || 0,
            photos: parseCarPhotos(car.id, car.photos),
        };
    }

    async updateCarStatus(user: CrmUser, carId: number, status: number) {
        if (user.role !== Roles.SuperAdmin) {
            throw new ForbiddenException('Тільки адміністратор може змінювати статус автомобіля');
        }
        if (![2, 3, 4].includes(status)) {
            throw new BadRequestException('Недопустиме значення статусу');
        }

        const pool = await this.pool();
        const [result] = await pool.execute('UPDATE cars SET status = ? WHERE id = ?', [status, carId]);
        if ((result as any).affectedRows === 0) {
            throw new NotFoundException('Автомобіль не знайдено');
        }
        return { success: true, message: 'Статус успішно оновлено', carId, status };
    }
}
