import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { User } from '@prisma/client';
import { ExternalDbManager } from '../client-db/client-db.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrdersService {
    constructor(private readonly dbManager: ExternalDbManager) { }
    async findAll(dbName: string, user: User, search?: string) {
        if (!user) {
            throw new BadRequestException();
        }

        const pool = await this.dbManager.getConnection(dbName);

        let sql = 'SELECT * FROM car_orders';
        const params: any[] = [];

        if (user.role !== 'SuperAdmin') {
            sql += ' WHERE user = ?';
            params.push(user.id);
        }

        if (search) {
            const searchCondition = `
            (
                brand_names LIKE ?
                OR model_names LIKE ?
                OR car_number LIKE ?
            )
        `;

            sql += user.role === 'SuperAdmin'
                ? ` WHERE ${searchCondition}`
                : ` AND ${searchCondition}`;

            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam);
        }

        sql += ' ORDER BY id DESC';

        const [rows] = await pool.query(sql, params);

        return rows;
    } 

    async findOne(dbName: string, id: number) {
        const pool = await this.dbManager.getConnection(dbName);
        const [rows]: any = await pool.query('SELECT * FROM car_orders WHERE id = ?', [id]);

        if (!rows || rows.length === 0) {
            throw new NotFoundException(`Замовлення з ID ${id} не знайдено`);
        }
        return rows[0];
    }

    async create(dbName: string, createOrderDto: CreateOrderDto, user: User) {
        const pool = await this.dbManager.getConnection(dbName);

        const dataToInsert = { ...createOrderDto, user: user.id };

        if (dataToInsert['updated_at']) {
            dataToInsert['updated_at'] = new Date(dataToInsert['updated_at'])
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ');
        }

        const keys = Object.keys(dataToInsert);
        const values = Object.values(dataToInsert);

        const placeholders = keys.map(() => '?').join(', ');
        const sql = `INSERT INTO car_orders (${keys.join(', ')}) VALUES (${placeholders})`;

        const [result]: any = await pool.query(sql, values);
        return this.findOne(dbName, result.insertId);
    }

    async update(dbName: string, id: number, updateOrderDto: UpdateOrderDto) {
        const pool = await this.dbManager.getConnection(dbName);

        const dataToUpdate = { ...updateOrderDto };

        if (dataToUpdate['updated_at']) {
            dataToUpdate['updated_at'] = new Date(dataToUpdate['updated_at'])
                .toISOString()
                .slice(0, 19)
                .replace('T', ' ');
        }

        const keys = Object.keys(dataToUpdate);

        if (keys.length === 0) return this.findOne(dbName, id);

        const setClause = keys.map(key => `${key} = ?`).join(', ');
        const values = [...Object.values(dataToUpdate), id];

        const sql = `UPDATE car_orders SET ${setClause} WHERE id = ?`;
        await pool.query(sql, values);

        return this.findOne(dbName, id);
    }
    async remove(dbName: string, id: number) {
        const pool = await this.dbManager.getConnection(dbName);
        await pool.query('DELETE FROM car_orders WHERE id = ?', [id]);
        return { success: true };
    }
}