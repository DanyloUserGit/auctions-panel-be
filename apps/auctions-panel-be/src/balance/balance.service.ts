import { Injectable } from '@nestjs/common';
import { CLIENT_DB, ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class BalanceService {
    constructor(private dbManager: ExternalDbManager) { }

    // 1. Отримання унікальних клієнтів (поле `zamovnyk`) у межах доступних користувачу (null - усі).
    async getClients(allowedClients: string[] | null): Promise<string[]> {
        if (allowedClients && allowedClients.length === 0) return [];
        const pool = await this.dbManager.getConnection(CLIENT_DB.crm);

        const scope = allowedClients ? ` AND zamovnyk IN (${allowedClients.map(() => '?').join(',')})` : '';
        const [rows]: any = await pool.query(
            `SELECT DISTINCT zamovnyk FROM transport_payments
       WHERE zamovnyk IS NOT NULL AND zamovnyk != ''${scope}
       ORDER BY zamovnyk ASC`,
            allowedClients ?? [],
        );

        return rows.map((r: any) => r.zamovnyk);
    }

    // 2. Отримання даних балансу
    async getBalances(allowedClients: string[] | null, clientFilter?: string, asof?: string) {
        if (allowedClients && allowedClients.length === 0) return [];
        const pool = await this.dbManager.getConnection(CLIENT_DB.crm);

        // Використовуємо WHERE 1=1 для зручного додавання умов
        let query = `SELECT id, marka_model, numer_vin, zamovnyk, to_pay_usd, to_pay_eur, to_pay_pln, to_pay_uah, extra_notes, transport_date 
                 FROM transport_payments WHERE 1=1`;
        const params: any[] = [];

        // Лише клієнти, доступні користувачу
        if (allowedClients) {
            query += ` AND zamovnyk IN (${allowedClients.map(() => '?').join(',')})`;
            params.push(...allowedClients);
        }

        // Фільтр по клієнту
        if (clientFilter && clientFilter !== 'ALL') {
            query += ` AND zamovnyk = ?`;
            params.push(clientFilter);
        }

        // Фільтр "Станом на"
        if (asof) {
            query += ` AND transport_date <= ?`;
            params.push(asof);
        }

        // ВАЖЛИВО: Додано сортування по id DESC для стабільності розрахунку балансу
        query += ` ORDER BY transport_date DESC, id DESC`;
        const [rows]: any = await pool.execute(query, params);

        const clientsData: Record<string, any> = {};

        // КРОК 1: Формуємо базові записи та рахуємо загальний підсумок (GRAND TOTAL)
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

            const notes = (row.extra_notes || '').toLowerCase();
            const isPlus = notes.startsWith('привезли') || notes.startsWith('повернення');
            const multiplier = isPlus ? 1 : -1;

            const usd = Number(row.to_pay_usd || 0);
            const eur = Number(row.to_pay_eur || 0);
            const pln = Number(row.to_pay_pln || 0);
            const uah = Number(row.to_pay_uah || 0);

            // Обчислюємо ефект конкретної операції (+ або -)
            const effectUsd = usd * multiplier;
            const effectEur = eur * multiplier;
            const effectPln = pln * multiplier;
            const effectUah = uah * multiplier;

            // Додаємо до загального підсумку
            clientsData[clientName].totalUsd += effectUsd;
            clientsData[clientName].totalEur += effectEur;
            clientsData[clientName].totalPln += effectPln;
            clientsData[clientName].totalUah += effectUah;

            clientsData[clientName].records.push({
                id: row.id,
                vin: row.numer_vin,
                model: row.marka_model,
                date: row.transport_date,
                notes: row.extra_notes,
                isPlus,
                // Зберігаємо ефект для фронту (наприклад, -8607.83 €)
                effectUsd, effectEur, effectPln, effectUah
            });
        }

        // КРОК 2: Розрахунок рухомого балансу (Running Balance) як в старому PHP
        // Оскільки записи відсортовані DESC (від найновіших до найстаріших),
        // ми беремо фінальний баланс і віднімаємо від нього ефект кожної операції,
        // рухаючись вниз по історії.
        for (const clientName in clientsData) {
            const client = clientsData[clientName];
            
            let currentUsd = client.totalUsd;
            let currentEur = client.totalEur;
            let currentPln = client.totalPln;
            let currentUah = client.totalUah;

            for (const record of client.records) {
                // Записуємо баланс на момент ПІСЛЯ цієї операції
                record.balanceUsd = currentUsd;
                record.balanceEur = currentEur;
                record.balancePln = currentPln;
                record.balanceUah = currentUah;

                // Віднімаємо ефект цієї операції, щоб отримати баланс ДО неї
                // для наступного (старішого) запису в циклі
                currentUsd -= record.effectUsd;
                currentEur -= record.effectEur;
                currentPln -= record.effectPln;
                currentUah -= record.effectUah;
            }
        }

        return Object.values(clientsData);
    }
}