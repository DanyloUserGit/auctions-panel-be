import { Injectable } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class BalanceService {
    constructor(private dbManager: ExternalDbManager) { }

    // 1. Отримання унікальних клієнтів (поле `zamovnyk`)
    async getClients(dbName: string): Promise<string[]> {
        const pool = await this.dbManager.getConnection(dbName);

        // Робимо швидку вибірку тільки унікальних замовників
        const [rows]: any = await pool.execute(
            `SELECT DISTINCT zamovnyk FROM transport_payments 
       WHERE zamovnyk IS NOT NULL AND zamovnyk != '' 
       ORDER BY zamovnyk ASC`
        );

        return rows.map((r: any) => r.zamovnyk);
    }

    // 2. Отримання даних балансу
    async getBalances(dbName: string, clientFilter?: string) {
        const pool = await this.dbManager.getConnection(dbName);

        // Вибираємо тільки ті колонки, які існують і нам потрібні
        let query = `SELECT id, marka_model, numer_vin, zamovnyk, to_pay_usd, to_pay_eur, to_pay_pln, to_pay_uah, extra_notes, transport_date 
                 FROM transport_payments`;
        const params: any[] = [];

        // Фільтр по клієнту
        if (clientFilter && clientFilter !== 'ALL') {
            query += ` WHERE zamovnyk = ?`;
            params.push(clientFilter);
        }

        query += ` ORDER BY transport_date DESC`;
        const [rows]: any = await pool.execute(query, params);

        const clientsData: Record<string, any> = {};

        for (const row of rows) {
            const clientName = row.zamovnyk || 'Невідомий клієнт';

            if (!clientsData[clientName]) {
                clientsData[clientName] = {
                    clientName: clientName,
                    totalUsd: 0,
                    totalEur: 0,
                    totalPln: 0,
                    totalUah: 0,
                    records: []
                };
            }

            // Визначаємо, чи це нарахування чи списання
            const notes = (row.extra_notes || '').toLowerCase();
            const isPlus = notes.startsWith('привезли') || notes.startsWith('повернення');
            const multiplier = isPlus ? 1 : -1;

            // Суми з колонок to_pay_*
            const usd = Number(row.to_pay_usd || 0);
            const eur = Number(row.to_pay_eur || 0);
            const pln = Number(row.to_pay_pln || 0);
            const uah = Number(row.to_pay_uah || 0);

            // Оновлюємо загальний баланс клієнта
            clientsData[clientName].totalUsd += usd * multiplier;
            clientsData[clientName].totalEur += eur * multiplier;
            clientsData[clientName].totalPln += pln * multiplier;
            clientsData[clientName].totalUah += uah * multiplier;

            // Додаємо запис для деталізації на фронтенді
            clientsData[clientName].records.push({
                id: row.id,
                vin: row.numer_vin,      // підставляємо точну назву колонки
                model: row.marka_model,  // підставляємо точну назву колонки
                date: row.transport_date,
                usd, eur, pln, uah,
                notes: row.extra_notes,
                isPlus
            });
        }

        return Object.values(clientsData);
    }
}