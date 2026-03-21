import { Injectable, BadRequestException } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

@Injectable()
export class ProcessesService {
    constructor(private readonly dbManager: ExternalDbManager) { }

    // Допоміжні функції
    private isFilled(v: any): boolean {
        if (v === null || v === undefined) return false;
        if (v instanceof Date) return true; // Якщо це об'єкт Date, поле точно заповнене

        // Якщо це рядок або число, безпечно конвертуємо в рядок перед trim()
        const str = String(v).trim().toLowerCase();
        if (str === '' || str === 'null' || str === 'none' || str === 'n/a') return false;
        if (str === '0000-00-00' || str === '0000-00-00 00:00:00' || str === '0') return false;
        return true;
    }

    private asofDone(v: any, asof: string): boolean {
        if (!this.isFilled(v)) return false;
        if (!asof) return true;

        const date = v instanceof Date ? v : new Date(v);
        if (isNaN(date.getTime())) return false;

        // Форматуємо дату в YYYY-MM-DD локального часу
        // (не використовуємо toISOString(), бо воно може зсунути дату на день назад через часовий пояс)
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        const formattedDate = `${year}-${month}-${day}`;

        return formattedDate <= asof;
    }
    private listTechDocUrls(documents: string | null): string[] {
        if (!documents) return [];
        return documents.split('|').filter(u => {
            const url = u.trim();
            if (!url) return false;
            const base = url.split('/').pop()?.toLowerCase() || '';
            return base.startsWith('dowod_');
        });
    }

    async getProcesses(dbName: string, query: any) {
        const db = await this.dbManager.getConnection(dbName);

        const { clients, clientIds, showAll, open, asof } = query;
        const asofVal = (asof && /^\d{4}-\d{2}-\d{2}$/.test(asof)) ? asof : '';
        const onlyOpen = open === '1' || open === 'true';

        let verifiedClients: any[] = [];
        let clientNames: string[] = [];

        if (!showAll) {
            if (!clients || !clientIds || clients.length !== clientIds.length) {
                throw new BadRequestException('Invalid clients data');
            }

            for (let i = 0; i < clients.length; i++) {
                const [rows] = await db.query(
                    `SELECT id, name, info, deposit, deposit_comment FROM buyers WHERE id = ? AND name = ? LIMIT 1`,
                    [clientIds[i], clients[i]]
                );
                if ((rows as any[]).length === 0) {
                    throw new BadRequestException('Invalid buyer name/id pair');
                }
                verifiedClients.push((rows as any[])[0]);
                clientNames.push(clients[i]);
            }
        }

        // 2. Отримання автомобілів
        // 2. Отримання автомобілів
        let carsSql = `
      SELECT id, zamovnyk, marka_model, numer_rej, numer_vin, google_link, documents,
             data_rej, data_faktury_zakup, data_oplaty, data_zezwolenia, data_zamowienia_transportu,
             transport, data_dostarczenia_auta, data_wysylki_cmr, data_dostarczenia_dokumentow,
             data_faktury_sprzedaz
      FROM cars_data
    `;

        // ВИПРАВЛЕННЯ: Додано тип any[]
        const params: any[] = [];

        if (!showAll && clientNames.length > 0) {
            carsSql += ` WHERE zamovnyk IN (?) `;
            params.push(clientNames); // Тепер помилки не буде
        }
        carsSql += ` ORDER BY id DESC`;

        const [carsRows] = await db.query(carsSql, params);
        let cars: any[] = carsRows as any[];

        // 3. Фільтрація "Станом на"
        if (asofVal) {
            cars = cars.filter(r => {
                const dt = r.data_faktury_zakup;
                if (!this.isFilled(dt)) return true;

                const date = dt instanceof Date ? dt : new Date(dt);
                if (isNaN(date.getTime())) return true;

                const year = date.getFullYear();
                const month = String(date.getMonth() + 1).padStart(2, '0');
                const day = String(date.getDate()).padStart(2, '0');
                const formattedDate = `${year}-${month}-${day}`;

                return formattedDate <= asofVal;
            });
        }

        const processedCars: any[] = [];
        const stats = { wait_pay: 0, wait_perm: 0, wait_trsp: 0, wait_dauto: 0, wait_cmr: 0, wait_docs: 0, realized: 0, total: 0 };

        // 4. Опрацювання логіки статусів
        for (const r of cars) {
            const doneOplata = this.asofDone(r.data_oplaty, asofVal);
            const doneDauto = this.asofDone(r.data_dostarczenia_auta, asofVal);
            const doneZez = this.asofDone(r.data_zezwolenia, asofVal);
            const doneTrsp = this.asofDone(r.data_zamowienia_transportu, asofVal);
            const doneDocs = this.asofDone(r.data_dostarczenia_dokumentow, asofVal);
            const doneCmr = this.asofDone(r.data_wysylki_cmr, asofVal);
            const doneSale = this.asofDone(r.data_faktury_sprzedaz, asofVal);

            const hasZezEff = doneZez || doneDauto;
            const hasTrspEff = doneTrsp || doneDauto;
            const hasCmrEff = doneCmr || doneDocs;
            const isRealizedStrict = doneSale && doneDauto && doneDocs;

            if (onlyOpen) {
                const missingAny = !doneOplata || !hasZezEff || !hasTrspEff || !doneDauto || !hasCmrEff || !doneDocs || !doneSale;
                if (!missingAny) continue; // Пропускаємо, якщо все виконано і стоїть фільтр
            }

            // Перевірка наявності протоколу (оптимізовано - можна винести в JOIN або зробити масовий запит, але для точності залишаємо логіку)
            const vinClean = (r.numer_vin || '').replace(/[^A-Za-z0-9]/g, '');
            let protocol = { count: 0, first_id: null };
            if (vinClean) {
                const [protoRows] = await db.query(`SELECT id FROM protocols WHERE vin = ? ORDER BY id DESC`, [vinClean]);
                const pRows = protoRows as any[];
                protocol = { count: pRows.length, first_id: pRows.length > 0 ? pRows[pRows.length - 1].id : null };
            }

            // Збір статистики
            if (!doneOplata) stats.wait_pay++;
            if (doneOplata && !hasZezEff && !hasTrspEff && !doneDauto) stats.wait_perm++;
            if (doneOplata && hasZezEff && !hasTrspEff && !doneDauto) stats.wait_trsp++;
            if (doneOplata && hasZezEff && hasTrspEff && !doneDauto) stats.wait_dauto++;
            if (doneDauto && !hasCmrEff) stats.wait_cmr++;
            if (!doneDocs) stats.wait_docs++;
            if (isRealizedStrict) stats.realized++;

            processedCars.push({
                ...r,
                techDocsUrls: this.listTechDocUrls(r.documents),
                protocol,
                statuses: {
                    doneOplata, doneZez, doneTrsp, doneDauto, doneCmr, doneDocs, doneSale,
                    hasZezEff, hasTrspEff, hasCmrEff, isRealizedStrict
                }
            });
        }

        stats.total = processedCars.length;

        return {
            clientInfo: showAll ? { name: 'Всі клієнти' } : (verifiedClients.length > 1 ? { name: clientNames.join(' | ') } : verifiedClients[0]),
            stats,
            cars: processedCars
        };
    }
}