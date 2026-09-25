import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { AccessStatus, Roles } from '@prisma/client';
import { CLIENT_DB, ExternalDbManager } from '../client-db/client-db.service';
import { CrmScopeService } from '../client-db/crm-scope.service';
import { PrismaService } from '../prisma/prisma.service';
import { WonCarsService } from '../won-cars/won-cars.service';
import { CarDto, CarFilters, CarStatus } from './dto/car.dto';

export type InStockUser = { id: string; role: Roles; accessStatus: AccessStatus };

const STATUS_TO_DB: Record<CarStatus, number> = { available: 0, reserved: 1, sold: 2 };
const STATUS_FROM_DB: Record<number, CarStatus> = { 0: 'available', 1: 'reserved', 2: 'sold' };

// «В наявності» (ТЗ 13.3): авто, які користувачі продають одне одному.
// - бачать усі, крім статусу «Дозволені покупки без доступу до продажів»;
// - додають адміни та користувачі зі статусом «Дозволені покупки + дозволені продажі»;
// - «Редагувати» і «Продати» - власник запису та адміни в межах прав
//   (SuperAdmin - усі авто, GA - свої та учасників своєї групи).
@Injectable()
export class InStockService {
    constructor(
        private readonly dbManager: ExternalDbManager,
        private readonly prisma: PrismaService,
        private readonly scope: CrmScopeService,
        private readonly wonCars: WonCarsService,
    ) { }

    private pool() {
        return this.dbManager.getConnection(CLIENT_DB.main);
    }

    private isAdmin(user: InStockUser) {
        return user.role === Roles.SuperAdmin || user.role === Roles.Admin;
    }

    canView(user: InStockUser) {
        return this.isAdmin(user) || user.accessStatus !== AccessStatus.PurchaseNoSales;
    }

    canAdd(user: InStockUser) {
        return this.isAdmin(user) || user.accessStatus === AccessStatus.PurchaseSale;
    }

    private assertCanView(user: InStockUser) {
        if (!this.canView(user)) throw new ForbiddenException('Ваш статус не дає доступу до продажів');
    }

    // Авто без відомого власника (додані до платформи) змінює лише SuperAdmin.
    private async canEdit(user: InStockUser, ownerId: string | undefined) {
        if (user.role === Roles.SuperAdmin) return true;
        if (!ownerId) return false;
        if (user.role === Roles.Admin) return this.scope.canAccessOwner(user, ownerId);
        return ownerId === user.id && user.accessStatus === AccessStatus.PurchaseSale;
    }

    private async owners(carIds: number[]) {
        if (carIds.length === 0) return new Map<number, { id: string; firstName: string; lastName: string }>();
        const rows = await this.prisma.inStockCarOwner.findMany({
            where: { carId: { in: carIds } },
            select: { carId: true, owner: { select: { id: true, firstName: true, lastName: true } } },
        });
        return new Map(rows.map((r) => [r.carId, r.owner]));
    }

    private mapRow(row: any) {
        const photos: string[] = row.photos
            ? String(row.photos).split(',').map((p: string) => p.trim()).filter(Boolean)
            : [];
        return {
            id: row.id,
            brandId: row.brand_id,
            modelId: row.model_id,
            brand: row.brand || 'Невідомо',
            model: row.model || 'Невідомо',
            year: row.first_on_road ? new Date(row.first_on_road * 1000).getFullYear() : null,
            mileage: row.mileage || 0,
            // fuel зберігає повний текст «двигуна» (об'єм + паливо) - єдине джерело, без дублювання.
            engine: (row.fuel || '').trim(),
            transmission: row.transmission || 'Не вказано',
            price: row.price || 0,
            chassis: row.chassis || '',
            photos,
            imageUrl: photos[0] ?? null,
            status: STATUS_FROM_DB[row.status] ?? 'available',
            location: row.location || '',
        };
    }

    private async withPermissions(user: InStockUser, cars: ReturnType<InStockService['mapRow']>[]) {
        const owners = await this.owners(cars.map((c) => c.id));
        return Promise.all(
            cars.map(async (car) => {
                const owner = owners.get(car.id);
                const canEdit = await this.canEdit(user, owner?.id);
                return {
                    ...car,
                    owner: owner ? { id: owner.id, name: `${owner.firstName} ${owner.lastName}` } : null,
                    canEdit,
                    canSell: canEdit && car.status !== 'sold',
                };
            }),
        );
    }

    private readonly selectSql = `
        SELECT c.id, c.brand_id, c.model_id, c.price, c.fuel, c.first_on_road, c.transmission, c.mileage,
               c.location, c.photos, c.chassis, c.status, b.name AS brand, m.name AS model
        FROM cars_for_sale c
        LEFT JOIN brands b ON b.id = c.brand_id
        LEFT JOIN models m ON m.id = c.model_id`;

    async getInStockCars(user: InStockUser, filters: CarFilters) {
        this.assertCanView(user);
        const pool = await this.pool();

        const conditions: string[] = [];
        const params: unknown[] = [];
        if (filters.search) {
            conditions.push('(b.name LIKE ? OR m.name LIKE ? OR c.chassis LIKE ?)');
            const like = `%${filters.search}%`;
            params.push(like, like, like);
        }
        if (filters.status) {
            conditions.push('c.status = ?');
            params.push(STATUS_TO_DB[filters.status]);
        }
        if (filters.priceFrom !== undefined) {
            conditions.push('c.price >= ?');
            params.push(filters.priceFrom);
        }
        if (filters.priceTo !== undefined) {
            conditions.push('c.price <= ?');
            params.push(filters.priceTo);
        }

        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(`${this.selectSql}${where} ORDER BY c.id DESC`, params);
        return {
            canAdd: this.canAdd(user),
            cars: await this.withPermissions(user, (rows as any[]).map((r) => this.mapRow(r))),
        };
    }

    async getCar(user: InStockUser, id: number) {
        this.assertCanView(user);
        const pool = await this.pool();
        const [rows]: any = await pool.query(`${this.selectSql} WHERE c.id = ?`, [id]);
        if (!rows?.[0]) throw new NotFoundException('Авто не знайдено');
        const [car] = await this.withPermissions(user, [this.mapRow(rows[0])]);
        return car;
    }

    async getBrands(user: InStockUser, query?: string) {
        this.assertCanView(user);
        const pool = await this.pool();
        const [rows] = await pool.query(
            'SELECT id, name FROM brands WHERE name LIKE ? ORDER BY name LIMIT 50',
            [`%${query ?? ''}%`],
        );
        return rows;
    }

    async getModels(user: InStockUser, brandId: number, query?: string) {
        this.assertCanView(user);
        const pool = await this.pool();
        const [rows] = await pool.query(
            'SELECT id, name FROM models WHERE brand_id = ? AND name LIKE ? ORDER BY name LIMIT 100',
            [brandId, `%${query ?? ''}%`],
        );
        return rows;
    }

    // Марка й модель зберігаються лише за ID з довідника, модель має належати марці.
    private async assertBrandModel(brandId: number, modelId: number) {
        const pool = await this.pool();
        const [rows]: any = await pool.query('SELECT id FROM models WHERE id = ? AND brand_id = ?', [modelId, brandId]);
        if (!rows?.length) throw new BadRequestException('Модель не належить обраній марці');
    }

    private columns(car: CarDto) {
        return {
            brand_id: car.brandId,
            model_id: car.modelId,
            price: car.price,
            transmission: car.transmission,
            fuel: car.engine,
            mileage: car.mileage,
            chassis: car.chassis,
            status: STATUS_TO_DB[car.status],
            first_on_road: Math.floor(new Date(car.year, 0, 1).getTime() / 1000),
            photos: car.photos.join(','),
            location: car.location,
        };
    }

    async createCar(user: InStockUser, car: CarDto & { sourcePurchaseId?: number }) {
        if (!this.canAdd(user)) {
            throw new ForbiddenException('Додавати авто можуть адміністратори та користувачі зі статусом «Дозволені покупки + дозволені продажі»');
        }
        await this.assertBrandModel(car.brandId, car.modelId);

        // Виставлення з «Покупок»: лише власна (видима користувачу) покупка і лише один раз.
        let source: string | null = null;
        if (car.sourcePurchaseId) {
            await this.wonCars.getWonCar(user, car.sourcePurchaseId);
            source = `won:${car.sourcePurchaseId}`;
            const pool = await this.pool();
            const [existing]: any = await pool.query('SELECT id FROM cars_for_sale WHERE donor_uniq_id = ?', [source]);
            if (existing.length) throw new ConflictException('Це авто вже виставлене на продаж');
        }

        const data = { ...this.columns(car), auction_id: 0, donor_uniq_id: source };
        const keys = Object.keys(data);
        const pool = await this.pool();
        const [result]: any = await pool.query(
            `INSERT INTO cars_for_sale (${keys.join(', ')}) VALUES (${keys.map(() => '?').join(', ')})`,
            Object.values(data),
        );

        await this.prisma.inStockCarOwner.create({ data: { carId: result.insertId, ownerId: user.id } });
        return this.getCar(user, result.insertId);
    }

    private async assertCanEdit(user: InStockUser, id: number) {
        this.assertCanView(user);
        const pool = await this.pool();
        const [rows]: any = await pool.query('SELECT id FROM cars_for_sale WHERE id = ?', [id]);
        if (!rows?.length) throw new NotFoundException('Авто не знайдено');

        const owner = await this.prisma.inStockCarOwner.findUnique({ where: { carId: id } });
        if (!(await this.canEdit(user, owner?.ownerId))) {
            throw new ForbiddenException('Змінювати це авто може лише його власник або адміністратор');
        }
    }

    async updateCar(user: InStockUser, id: number, car: CarDto) {
        await this.assertCanEdit(user, id);
        await this.assertBrandModel(car.brandId, car.modelId);

        const data = this.columns(car);
        const pool = await this.pool();
        await pool.query(
            `UPDATE cars_for_sale SET ${Object.keys(data).map((k) => `${k} = ?`).join(', ')} WHERE id = ?`,
            [...Object.values(data), id],
        );
        return this.getCar(user, id);
    }

    // «Продати»: авто позначається проданим і зникає з доступних до продажу ([?15]).
    async sellCar(user: InStockUser, id: number) {
        await this.assertCanEdit(user, id);
        const pool = await this.pool();
        await pool.query('UPDATE cars_for_sale SET status = ? WHERE id = ?', [STATUS_TO_DB.sold, id]);
        return this.getCar(user, id);
    }
}
