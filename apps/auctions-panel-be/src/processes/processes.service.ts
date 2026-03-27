import { Injectable } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class ProcessesService {
    constructor(private readonly dbManager: ExternalDbManager) { }

    private isFilled(v: any): boolean {
        if (v === null || v === undefined) return false;
        if (v instanceof Date) return true;
        const str = String(v).trim().toLowerCase();
        if (str === '' || str === 'null' || str === 'none' || str === 'n/a') return false;
        if (str === '0000-00-00' || str === '0000-00-00 00:00:00' || str === '0') return false;
        return true;
    }

    private asofDone(v: any, asof: string | null): boolean {
        if (!this.isFilled(v)) return false;
        if (!asof) return true;

        const date = v instanceof Date ? v : new Date(v);
        if (isNaN(date.getTime())) return false;

        // Форматуємо дату для порівняння (YYYY-MM-DD)
        const yyyy = date.getFullYear();
        const mm = String(date.getMonth() + 1).padStart(2, '0');
        const dd = String(date.getDate()).padStart(2, '0');
        const dateStr = `${yyyy}-${mm}-${dd}`;

        return dateStr <= asof;
    }

    private listTechDocUrls(documents: any): string[] {
        if (!documents) return [];
        const str = String(documents);
        return str.split('|').map(u => u.trim()).filter(u => u !== '');
    }

    async getProcesses(dbName: string, options: any) {
        const db = await this.dbManager.getConnection(dbName);
        let { clients, showAll, open, asof, search } = options;

        asof = (asof && /^\d{4}-\d{2}-\d{2}$/.test(asof)) ? asof : null;

        let query = `
            SELECT id, zamovnyk, marka_model, numer_rej, numer_vin, google_link, documents,
                   data_rej, data_faktury_zakup, data_oplaty, data_zezwolenia, data_zamowienia_transportu,
                   transport, data_dostarczenia_auta, data_wysylki_cmr, data_dostarczenia_dokumentow,
                   data_faktury_sprzedaz
            FROM cars_data
        `;

        const params: any[] = [];
        const conditions: string[] = [];

        // Умова 1: Фільтр по клієнтах
        if (!showAll && clients && clients.length > 0) {
            conditions.push(`zamovnyk IN (${clients.map(() => '?').join(',')})`);
            params.push(...clients);
        }

        // Умова 2: Текстовий пошук (клієнт / модель / реєстрація / vin)
        if (search && search.trim() !== '') {
            const searchTerm = `%${search.trim()}%`;
            conditions.push(`(
                zamovnyk LIKE ? OR 
                marka_model LIKE ? OR 
                numer_rej LIKE ? OR 
                numer_vin LIKE ?
            )`);
            params.push(searchTerm, searchTerm, searchTerm, searchTerm);
        }

        // Якщо є хоча б одна умова (клієнти АБО пошук), додаємо WHERE
        if (conditions.length > 0) {
            query += ` WHERE ` + conditions.join(' AND ');
        }

        query += ` ORDER BY id DESC`;

        // Виконуємо запит ДО БАЗИ лише 1 раз
        const [rows]: any = await db.query(query, params);

        // 2. Оптимізація: Витягуємо всі протоколи ОДНИМ запитом
        const vins = rows
            .map((r: any) => String(r.numer_vin || '').trim())
            .filter((v: string) => v !== '');

        const protocolsMap: Record<string, { count: number, first_id: number | null }> = {};

        if (vins.length > 0) {
            const [pRows]: any = await db.query(
                `SELECT id, vin FROM protocols WHERE vin IN (${vins.map(() => '?').join(',')}) ORDER BY id ASC`,
                vins
            );

            for (const p of pRows) {
                const vin = String(p.vin).trim();
                if (!protocolsMap[vin]) {
                    protocolsMap[vin] = { count: 0, first_id: null };
                }
                protocolsMap[vin].count++;
                protocolsMap[vin].first_id = p.id;
            }
        }

        const processedCars: any[] = [];
        const stats = {
            wait_pay: 0, wait_perm: 0, wait_trsp: 0,
            wait_dauto: 0, wait_cmr: 0, wait_docs: 0,
            realized: 0, total: 0
        };

        // 3. Обробка кожного рядка та формування статусів на основі реальних колонок
        for (const r of rows) {

            // НОВЕ: Глобальний фільтр asof по даті закупівлі (як у PHP)
            if (asof && this.isFilled(r.data_faktury_zakup)) {
                // Якщо дата закупівлі Є, і вона БІЛЬША за asof (тобто asofDone = false)
                if (!this.asofDone(r.data_faktury_zakup, asof)) {
                    continue; // Повністю пропускаємо цю машину (вона ще не була куплена на момент asof)
                }
            }

            const vinClean = String(r.numer_vin || '').trim();
            const protocol = protocolsMap[vinClean] || { count: 0, first_id: null };

            // Розрахунок статусів як у PHP-файлі
            const doneOplata = this.asofDone(r.data_oplaty, asof);
            const doneZez = this.asofDone(r.data_zezwolenia, asof);
            const doneTrsp = this.asofDone(r.data_zamowienia_transportu, asof);
            const doneDauto = this.asofDone(r.data_dostarczenia_auta, asof);
            const doneCmrDate = this.asofDone(r.data_wysylki_cmr, asof);
            const doneDocs = this.asofDone(r.data_dostarczenia_dokumentow, asof);
            const doneSale = this.asofDone(r.data_faktury_sprzedaz, asof);

            // Ефективні статуси (як у PHP)
            const hasOpl = doneOplata;
            const hasDauto = doneDauto;
            const hasZezEff = doneZez || doneDauto;
            const hasTrspEff = doneTrsp || doneDauto;
            const hasCmrEff = doneCmrDate || doneDocs;
            const hasDocs = doneDocs;

            const isRealizedStrict = doneSale && doneDauto && doneDocs;

            // Логіка відкритого/закритого процесу (як у PHP)
            if (open) {
                const missingAny = !doneOplata || !hasZezEff || !hasTrspEff || !doneDauto || !hasCmrEff || !doneDocs || !doneSale;
                if (!missingAny) {
                    continue; // Пропускаємо закриті (реалізовані) процеси
                }
            }

            // Збір статистики
            if (!hasOpl) stats.wait_pay++;
            if (hasOpl && !hasZezEff && !hasTrspEff && !hasDauto) stats.wait_perm++;
            if (hasOpl && hasZezEff && !hasTrspEff && !hasDauto) stats.wait_trsp++;
            if (hasOpl && hasZezEff && hasTrspEff && !hasDauto) stats.wait_dauto++;
            if (hasDauto && !hasCmrEff) stats.wait_cmr++;
            if (!hasDocs) stats.wait_docs++;
            if (isRealizedStrict) stats.realized++;

            processedCars.push({
                ...r,
                client_name: r.zamovnyk,
                techDocsUrls: this.listTechDocUrls(r.documents),
                protocol,
                statuses: {
                    doneOplata, doneZez, doneTrsp, doneDauto, doneCmrDate, doneDocs, doneSale,
                    hasZezEff, hasTrspEff, hasCmrEff, isRealizedStrict
                }
            });
        }

        stats.total = processedCars.length;

        return {
            data: processedCars,
            stats
        };
    }
}