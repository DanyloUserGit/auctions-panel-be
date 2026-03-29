import { Injectable, NotFoundException } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { UpdateOrderDto } from './dto/update-order.dto';

@Injectable()
export class OrdersService {
    constructor(private readonly dbManager: ExternalDbManager) { }

    // Отримуємо всі замовлення з можливістю пошуку
    async findAll(dbName: string, search?: string) {
        const pool = await this.dbManager.getConnection(dbName);

        let sql = 'SELECT * FROM car_orders';
        const params: any[] = [];

        if (search) {
            // Зверніть увагу: замініть `car_number` на реальну назву вашої колонки для номера авто 
            // (можливо це plate_number, reg_number чи vin_code), якщо вона відрізняється.
            sql += ` WHERE brand_names LIKE ? OR model_names LIKE ? OR car_number LIKE ?`;
            const searchParam = `%${search}%`;
            params.push(searchParam, searchParam, searchParam);
        }

        sql += ' ORDER BY id DESC';

        const [rows] = await pool.query(sql, params);
        return rows;
    }

    // Отримуємо одне замовлення
    async findOne(dbName: string, id: number) {
        const pool = await this.dbManager.getConnection(dbName);
        const [rows]: any = await pool.query('SELECT * FROM car_orders WHERE id = ?', [id]);

        if (!rows || rows.length === 0) {
            throw new NotFoundException(`Замовлення з ID ${id} не знайдено`);
        }
        return rows[0];
    }

    async create(dbName: string, createOrderDto: CreateOrderDto) {
        const pool = await this.dbManager.getConnection(dbName);

        // Створюємо копію об'єкта, щоб не мутувати оригінальний DTO
        const dataToInsert = { ...createOrderDto };

        // Перетворюємо ISO дату в формат MySQL (YYYY-MM-DD HH:MM:SS)
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

    // Оновлення існуючого замовлення
    async update(dbName: string, id: number, updateOrderDto: UpdateOrderDto) {
        const pool = await this.dbManager.getConnection(dbName);

        const dataToUpdate = { ...updateOrderDto };

        // Перетворюємо ISO дату в формат MySQL при оновленні
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
    // Видалення
    async remove(dbName: string, id: number) {
        const pool = await this.dbManager.getConnection(dbName);
        // Виправлено order_requests на car_orders
        await pool.query('DELETE FROM car_orders WHERE id = ?', [id]);
        return { success: true };
    }
}