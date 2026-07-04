import { Injectable, OnModuleDestroy, BadRequestException, Logger } from '@nestjs/common';
import * as mysql from 'mysql2/promise';

@Injectable()
export class ExternalDbManager implements OnModuleDestroy {
    private connections = new Map<string, mysql.Pool>();
    private readonly logger = new Logger(ExternalDbManager.name);

    async getConnection(dbName: string): Promise<mysql.Pool> {
        const existingPool = this.connections.get(dbName);
        if (existingPool) return existingPool;

        const prefix = `DB_${dbName.toUpperCase()}`;
        const config = {
            host: process.env[`${prefix}_HOST`],
            user: process.env[`${prefix}_USER`],
            password: process.env[`${prefix}_PASS`],
            database: dbName,
        };
        console.log(`Connecting to ${dbName} at ${config.host} as ${config.user}`);
        if (!config.host || !config.user) {
            throw new BadRequestException(`Конфігурація для БД ${dbName} відсутня в .env`);
        }

        try {
            const pool = mysql.createPool({
                ...config,
                waitForConnections: true,
                connectionLimit: 10,
                enableKeepAlive: true,
                keepAliveInitialDelay: 10000,
            });

            this.connections.set(dbName, pool);
            this.logger.log(`Підключено до зовнішньої БД: ${dbName}`);
            return pool;
        } catch (error) {
            this.logger.error(`Помилка підключення до ${dbName}: ${(error as any).message}`);
            throw new BadRequestException('Неможливо з’єднатися з базою даних клієнта');
        }
    }

    async onModuleDestroy() {
        for (const [name, pool] of this.connections.entries()) {
            this.logger.log(`Закриття пулу для БД: ${name}`);
            await pool.end();
        }
    }
}