import { Injectable, NotFoundException } from '@nestjs/common';
import { CLIENT_DB, ExternalDbManager } from '../client-db/client-db.service';
import { CrmScopeService, type CrmUser } from '../client-db/crm-scope.service';
import { CreateOrderDto, ORDER_COLUMNS } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

// Замовлення (ТЗ 13.1): User бачить і змінює лише свої, GA - своєї групи, SuperAdmin - усі.
// Власник зберігається в car_orders.user (ID користувача платформи).
@Injectable()
export class OrdersService {
    constructor(
        private readonly dbManager: ExternalDbManager,
        private readonly scope: CrmScopeService,
    ) { }

    private pool() {
        return this.dbManager.getConnection(CLIENT_DB.main);
    }

    // Лише відомі колонки (ORDER_COLUMNS) і лише задані значення.
    private columns(dto: UpdateOrderDto) {
        return ORDER_COLUMNS.filter((key) => dto[key] !== undefined);
    }

    async findAll(user: CrmUser, search?: string) {
        const pool = await this.pool();
        const owners = await this.scope.ownerIds(user);

        const conditions: string[] = [];
        const params: unknown[] = [];

        if (owners) {
            conditions.push(`\`user\` IN (${owners.map(() => '?').join(', ')})`);
            params.push(...owners);
        }

        if (search) {
            conditions.push('(brand_names LIKE ? OR model_names LIKE ? OR internal_id LIKE ? OR phone LIKE ? OR last_name LIKE ?)');
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam, searchParam, searchParam);
        }

        const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
        const [rows] = await pool.query(`SELECT * FROM car_orders${where} ORDER BY id DESC`, params);
        return rows;
    }

    // Замовлення поза областю видимості користувача - так само «не знайдено», як і неіснуюче.
    async findOne(id: number, user: CrmUser) {
        const pool = await this.pool();
        const [rows]: any = await pool.query('SELECT * FROM car_orders WHERE id = ?', [id]);
        const order = rows?.[0];

        if (!order || !(await this.scope.canAccessOwner(user, order.user))) {
            throw new NotFoundException(`Замовлення з ID ${id} не знайдено`);
        }
        return order;
    }

    async create(dto: CreateOrderDto, user: CrmUser) {
        const pool = await this.pool();
        const keys = this.columns(dto);
        const columns = ['`user`', ...keys.map((k) => `\`${k}\``)];
        const values = [user.id, ...keys.map((k) => dto[k])];

        const [result]: any = await pool.query(
            `INSERT INTO car_orders (${columns.join(', ')}) VALUES (${columns.map(() => '?').join(', ')})`,
            values,
        );
        return this.findOne(result.insertId, user);
    }

    async update(id: number, dto: UpdateOrderDto, user: CrmUser) {
        await this.findOne(id, user);

        const keys = this.columns(dto);
        if (keys.length === 0) return this.findOne(id, user);

        const pool = await this.pool();
        await pool.query(
            `UPDATE car_orders SET ${keys.map((k) => `\`${k}\` = ?`).join(', ')} WHERE id = ?`,
            [...keys.map((k) => dto[k]), id],
        );
        return this.findOne(id, user);
    }

    async remove(id: number, user: CrmUser) {
        await this.findOne(id, user);
        const pool = await this.pool();
        await pool.query('DELETE FROM car_orders WHERE id = ?', [id]);
        return { success: true };
    }
}
