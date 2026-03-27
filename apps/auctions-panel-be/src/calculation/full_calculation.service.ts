import { BadRequestException, Injectable } from '@nestjs/common';
import { ExternalDbManager } from '../client-db/client-db.service';

export type CustomsTableId = '27031' | '27032' | '27033';


export interface ICalculationResult {
  basePriceFromDb: number;
  details: {
    importDuty: number;
    excise: number;
    vat: number;
    totalCustoms: number;
  };
  serviceFee: number;
  totalInUkraine: number;
  cards: Array<{
    code: string;
    title: string;
    totalUSD: number;
    brokerUSD: number;
    dutyEUR: number;
    dutyUSD: number;
    exciseEUR: number;
    exciseUSD: number;
    vatEUR: number;
    vatUSD: number;
    customsPaymentsEUR: number;
    customsPaymentsUSD: number;
  }>;
}

export interface ITableMeta {
  years: string[];
  cols: {
    marka: string;
    model: string;
    typ: string;
  };
  label: string;
}

export interface ITableRow {
  marka: string;
  model: string;
  typ: string;
  [key: string]: string | number | null;
}

export interface ISoldMeta {
  years: string[];
  activeYear: string;
  months: string[];
}

export interface ISoldRow {
  id: number;
  country: string;
  brand: string;
  model: string;
  detail: string | null;
  mileage_km: number | null;
  first_reg_fmt: string | null;
  sale_price: number;
  sale_date_fmt: string | null;
  sale_month: string | null;
}

export interface EstimateParams {
  table: CustomsTableId;
  marka: string;
  model: string;
  typ: string;
  year: string;
  auctionPrice: number;
  engineVolume: number;
  fuelType: 'petrol' | 'diesel';
  road?: number;
  cert?: number;
  border?: number;
  towing?: number;
  deliveryCost: number;
  eurToUsd?: number;
  batteryCapacity?: number;
  calculationType?: 'full' | 'reduced';
}

type FuelType = 'petrol' | 'diesel' | 'electric';
type CalcType = 'full' | 'reduced';

interface CalcParams {
  table: CustomsTableId;

  basePriceFromDb: number;
  deliveryCost: number;

  eurToUsd?: number;
  calculationType?: CalcType;

  engineVolume?: number;
  batteryCapacity?: number;

  year: number;
  fuelType: FuelType;

  road?: number;
  cert?: number;
  border?: number;
  towing?: number;
}

interface ColumnMap {
  marka: string;
  model: string;
  typ: string;
  date: string;
  years: string[];
}

@Injectable()
export class CalculationService {
  constructor(private readonly dbManager: ExternalDbManager) { }

  private readonly allowedTables: CustomsTableId[] = ['27031', '27032', '27033'];

  private validateTable(table: string): asserts table is CustomsTableId {
    if (!this.allowedTables.includes(table as CustomsTableId)) {
      throw new BadRequestException('Невірна таблиця');
    }
  }

  private ensureFiniteNumber(value: unknown, field: string): number {
    const n = Number(value);
    if (!Number.isFinite(n)) {
      throw new BadRequestException(`Некоректне число: ${field}`);
    }
    return n;
  }

  private ensurePositiveNumber(value: unknown, field: string): number {
    const n = this.ensureFiniteNumber(value, field);
    if (n <= 0) {
      throw new BadRequestException(`Поле ${field} має бути більше 0`);
    }
    return n;
  }

  private normalizeString(value: unknown): string {
    return String(value ?? '').trim();
  }

  private normalizeTyp(typ: string): string {
    const trimmed = this.normalizeString(typ);
    if (trimmed === 'Hybrid/Gasoline') return 'Gasoline';
    if (trimmed === 'Hybrid/Diesel') return 'Diesel';
    return trimmed;
  }

  private async detectColsAndYears(dbName: string, table: CustomsTableId): Promise<ColumnMap> {
    const pool = await this.dbManager.getConnection(dbName);
    const [rows] = (await pool.query(`SHOW COLUMNS FROM \`${table}\``)) as any[];

    const cols = (rows ?? []).map((row: any) => String(row.Field));
    const years = cols.filter((col: string) => /^(19|20)\d{2}$/.test(col)).sort();

    let marka = 'marka';
    let model = 'model';
    let typ = 'typ';
    let date = 'pochatok_dii';

    if (!cols.includes('marka') && cols.includes('марка')) marka = 'марка';
    if (!cols.includes('model') && cols.includes('модель')) model = 'модель';
    if (!cols.includes('typ') && cols.includes('тип')) typ = 'тип';
    if (!cols.includes('pochatok_dii') && cols.includes('початок дії')) date = 'початок дії';

    return { marka, model, typ, date, years };
  }

  private safeYearFromList(year: string, yearsList: string[]): string {
    const normalized = this.normalizeString(year);
    if (!yearsList.includes(normalized)) {
      throw new BadRequestException('Некоректний рік');
    }
    return normalized;
  }

  // ===================== BASIC LEGACY CALC =====================

  async getBrands(dbName: string, table: string): Promise<string[]> {
    this.validateTable(table);
    const pool = await this.dbManager.getConnection(dbName);
    const [rows] = (await pool.execute(
      `SELECT DISTINCT marka FROM \`${table}\` ORDER BY marka ASC`,
    )) as any[];

    return (rows ?? []).map((r: any) => String(r.marka ?? '').trim()).filter(Boolean);
  }

  async getModels(dbName: string, table: string, marka: string): Promise<string[]> {
    this.validateTable(table);
    const pool = await this.dbManager.getConnection(dbName);
    const [rows] = (await pool.execute(
      `SELECT DISTINCT model FROM \`${table}\` WHERE marka = ? ORDER BY model ASC`,
      [this.normalizeString(marka)],
    )) as any[];

    return (rows ?? []).map((r: any) => String(r.model ?? '').trim()).filter(Boolean);
  }

  async getBasePrice(
    dbName: string,
    table: string,
    marka: string,
    model: string,
    year: string,
  ): Promise<number> {
    this.validateTable(table);
    const years = (await this.detectColsAndYears(dbName, table)).years;
    const safeYear = this.safeYearFromList(year, years);
    const pool = await this.dbManager.getConnection(dbName);
    const sql = `SELECT \`${safeYear}\` AS price FROM \`${table}\` WHERE marka = ? AND model = ? LIMIT 1`;
    const [rows] = (await pool.execute(sql, [this.normalizeString(marka), this.normalizeString(model)])) as any[];
    return Number(rows?.[0]?.price || 0);
  }

  calculateFullEstimate(params: CalcParams): ICalculationResult {
    const currentYear = new Date().getFullYear();

    const basePrice = this.ensureFiniteNumber(params.basePriceFromDb, 'basePriceFromDb');
    const delivery = this.ensureFiniteNumber(params.deliveryCost, 'deliveryCost');

    const baseTotal = basePrice + delivery;

    let baseUSD = baseTotal;

    // ===================== TABLE 27031 (EUROPE) =====================
    if (params.table === '27031') {
      const eurToUsd = this.ensureFiniteNumber(params.eurToUsd, 'eurToUsd');
      baseUSD = baseTotal * eurToUsd;
    }

    // ===================== IMPORT DUTY =====================
    let importDuty = 0;

    if (params.table === '27031') {
      const type = params.calculationType || 'full';
      importDuty = baseUSD * (type === 'reduced' ? 0.014 : 0.1);
    }

    if (params.table === '27032') {
      importDuty = baseUSD * 0.1;
    }

    if (params.table === '27033') {
      importDuty = 0; // електро
    }

    // ===================== EXCISE =====================
    let excise = 0;

    if (params.table === '27033' || params.fuelType === 'electric') {
      const battery = this.ensurePositiveNumber(params.batteryCapacity, 'batteryCapacity');

      // приклад ставки (можеш змінити)
      const RATE_PER_KWH = 1;
      excise = battery * RATE_PER_KWH;
    } else {
      const engineVolume = this.ensurePositiveNumber(params.engineVolume, 'engineVolume');

      const baseRate =
        params.fuelType === 'petrol'
          ? engineVolume <= 3000 ? 50 : 100
          : engineVolume <= 3500 ? 75 : 150;

      let age = currentYear - params.year - 1;
      if (age <= 0) age = 1;
      if (age > 15) age = 15;

      excise = baseRate * (engineVolume / 1000) * age;
    }

    // ===================== VAT =====================
    const vat = (baseUSD + importDuty + excise) * 0.2;

    // ===================== TOTAL CUSTOMS =====================
    const totalCustoms = importDuty + excise + vat;

    // ===================== SERVICE FEE =====================
    let serviceFee = 0;

    if (params.table === '27031') {
      serviceFee = params.calculationType === 'reduced' ? 300 : 500;
    } else if (params.table === '27032') {
      serviceFee = 500;
    } else if (params.table === '27033') {
      serviceFee = 400;
    }

    // ===================== EXTRA COSTS =====================
    const extras =
      Number(params.road || 0) +
      Number(params.cert || 0) +
      Number(params.border || 0) +
      Number(params.towing || 0);

    // ===================== FINAL =====================
    const totalInUkraine =
      baseUSD +
      totalCustoms +
      serviceFee +
      extras;
    const eurToUsd = params.eurToUsd || 1;
    const usdToEur = 1 / eurToUsd;
    const cards = [
      {
        code: 'full',
        title: 'Повний розрахунок',

        totalUSD: Math.round(totalInUkraine),
        brokerUSD: Math.round(serviceFee),

        dutyUSD: Math.round(importDuty),
        dutyEUR: Math.round(importDuty * usdToEur),

        exciseUSD: Math.round(excise),
        exciseEUR: Math.round(excise * usdToEur),

        vatUSD: Math.round(vat),
        vatEUR: Math.round(vat * usdToEur),

        customsPaymentsUSD: Math.round(totalCustoms),
        customsPaymentsEUR: Math.round(totalCustoms * usdToEur),
      },
    ];
    return {
      basePriceFromDb: Math.round(baseUSD),
      details: {
        importDuty: Math.round(importDuty),
        excise: Math.round(excise),
        vat: Math.round(vat),
        totalCustoms: Math.round(totalCustoms),
      },
      serviceFee: Math.round(serviceFee),
      totalInUkraine: Math.round(totalInUkraine),
      cards
    };
  }

  async estimate(dbName: string, payload: EstimateParams): Promise<ICalculationResult> {
    this.validateTable(payload.table);
    if (payload.table === '27031' && !payload.eurToUsd) {
      throw new BadRequestException('Потрібен курс EUR/USD');
    }

    if (payload.table === '27033' && !payload.batteryCapacity) {
      throw new BadRequestException('Потрібна ємність батареї');
    }
    const basePriceFromDb = await this.getPriceBySelection(
      dbName,
      payload.table,
      payload.marka,
      payload.model,
      payload.typ,
      payload.year,
    );

    return this.calculateFullEstimate({
      table: payload.table,

      basePriceFromDb: basePriceFromDb ?? 0,
      deliveryCost: payload.deliveryCost,

      eurToUsd: payload.eurToUsd,
      calculationType: payload.calculationType,

      engineVolume: payload.engineVolume,
      batteryCapacity: payload.batteryCapacity,

      year: Number(payload.year),
      fuelType: payload.fuelType,

      road: payload.road,
      cert: payload.cert,
      border: payload.border,
      towing: payload.towing,
    });
  }
  // ===================== CASCADE SELECTS =====================

  async getTypes(dbName: string, table: string, marka: string, model: string): Promise<string[]> {
    this.validateTable(table);
    const pool = await this.dbManager.getConnection(dbName);
    const map = await this.detectColsAndYears(dbName, table);
    const [rows] = (await pool.execute(
      `SELECT DISTINCT TRIM(\`${map.typ}\`) AS v
       FROM \`${table}\`
       WHERE TRIM(\`${map.marka}\`) = ?
         AND TRIM(\`${map.model}\`) = ?
         AND \`${map.typ}\` IS NOT NULL AND TRIM(\`${map.typ}\`) <> ''
       ORDER BY v ASC`,
      [this.normalizeString(marka), this.normalizeString(model)],
    )) as any[];

    return (rows ?? []).map((row: any) => String(row.v ?? '').trim()).filter(Boolean);
  }

  async getAvailableYears(
    dbName: string,
    table: string,
    marka: string,
    model: string,
    typ: string,
  ): Promise<string[]> {
    this.validateTable(table);
    const pool = await this.dbManager.getConnection(dbName);
    const map = await this.detectColsAndYears(dbName, table);

    if (!map.years.length) return [];

    const parts = map.years.map(
      (year) =>
        `MAX(CASE WHEN \`${year}\` IS NOT NULL AND TRIM(CAST(\`${year}\` AS CHAR)) <> '' THEN 1 ELSE 0 END) AS y${year}`,
    );

    const [rows] = (await pool.execute(
      `SELECT ${parts.join(', ')}
       FROM \`${table}\`
       WHERE TRIM(\`${map.marka}\`) = ?
         AND TRIM(\`${map.model}\`) = ?
         AND TRIM(\`${map.typ}\`) = ?
       LIMIT 1`,
      [this.normalizeString(marka), this.normalizeString(model), this.normalizeString(typ)],
    )) as any[];

    const row = rows?.[0] ?? null;
    if (!row) return [];

    return map.years.filter((year) => Boolean(row[`y${year}`]));
  }

  async getPriceBySelection(
    dbName: string,
    table: string,
    marka: string,
    model: string,
    typ: string,
    year: string,
  ): Promise<number | null> {
    this.validateTable(table);
    const pool = await this.dbManager.getConnection(dbName);
    const map = await this.detectColsAndYears(dbName, table);
    const safeYear = this.safeYearFromList(year, map.years);

    const [rows] = (await pool.execute(
      `SELECT \`${safeYear}\` AS price
       FROM \`${table}\`
       WHERE TRIM(\`${map.marka}\`) = ?
         AND TRIM(\`${map.model}\`) = ?
         AND TRIM(\`${map.typ}\`) = ?
       LIMIT 1`,
      [this.normalizeString(marka), this.normalizeString(model), this.normalizeString(typ)],
    )) as any[];

    const row = rows?.[0];
    if (!row) return null;

    const raw = row.price;
    if (raw === null || raw === undefined || String(raw).trim() === '') return null;

    const value = Number(String(raw).replace(',', '.').replace(/\s+/g, ''));
    return Number.isFinite(value) ? value : null;
  }

  // ===================== TABLE TAB =====================

  async getTableMeta(dbName: string, table: string): Promise<ITableMeta> {
    this.validateTable(table);
    const map = await this.detectColsAndYears(dbName, table);

    const labels: Record<CustomsTableId, string> = {
      '27031': 'Таблиця 27031',
      '27032': 'Таблиця 27032',
      '27033': 'Таблиця 27033',
    };

    return {
      years: map.years,
      cols: {
        marka: map.marka,
        model: map.model,
        typ: map.typ,
      },
      label: labels[table],
    };
  }

  async getTableRows(
    dbName: string,
    table: string,
    filters: { qmarka?: string; qmodel?: string; qtyp?: string } = {},
  ): Promise<ITableRow[]> {
    this.validateTable(table);
    const pool = await this.dbManager.getConnection(dbName);
    const map = await this.detectColsAndYears(dbName, table);

    const where: string[] = ['1=1'];
    const params: unknown[] = [];

    const qmarka = this.normalizeString(filters.qmarka);
    const qmodel = this.normalizeString(filters.qmodel);
    const qtyp = this.normalizeString(filters.qtyp);

    if (qmarka) {
      where.push(`TRIM(\`${map.marka}\`) LIKE ?`);
      params.push(`%${qmarka.slice(0, 120)}%`);
    }
    if (qmodel) {
      where.push(`TRIM(\`${map.model}\`) LIKE ?`);
      params.push(`%${qmodel.slice(0, 120)}%`);
    }
    if (qtyp) {
      where.push(`TRIM(\`${map.typ}\`) LIKE ?`);
      params.push(`%${qtyp.slice(0, 120)}%`);
    }

    const select = [
      `TRIM(\`${map.marka}\`) AS marka`,
      `TRIM(\`${map.model}\`) AS model`,
      `TRIM(\`${map.typ}\`) AS typ`,
      ...map.years.map((year) => `\`${year}\` AS \`${year}\``),
    ];

    const [rows] = (await pool.execute(
      `SELECT ${select.join(', ')}
       FROM \`${table}\`
       WHERE ${where.join(' AND ')}
       ORDER BY marka ASC, model ASC, typ ASC
       LIMIT 5000`,
      params as any[],
    )) as any[];

    return (rows ?? []) as ITableRow[];
  }

  // ===================== SOLD TAB =====================

  private safeSoldYear(year?: string): string | null {
    const value = this.normalizeString(year);
    if (!value) return null;
    return /^(19|20)\d{2}$/.test(value) ? value : null;
  }

  private safeSoldMonths(input?: string | string[]): string[] {
    let csv = '';
    if (Array.isArray(input)) {
      csv = input.join(',');
    } else {
      csv = this.normalizeString(input);
    }
    if (!csv) return [];
    return [
      ...new Set(
        csv
          .split(',')
          .map((m) => m.trim())
          .filter((m) => /^(0[1-9]|1[0-2])$/.test(m)),
      ),
    ];
  }

  private safeSoldSort(sort?: string): string {
    const allowed = new Set([
      'sale_date',
      'sale_price',
      'mileage_km',
      'brand',
      'model',
      'country',
      'first_reg_date',
      'sale_month',
    ]);
    return allowed.has(String(sort ?? '')) ? String(sort) : 'sale_date';
  }

  private safeSoldDir(dir?: string): 'ASC' | 'DESC' {
    return String(dir ?? '').toUpperCase() === 'ASC' ? 'ASC' : 'DESC';
  }

  async getSoldMeta(dbName: string, year?: string): Promise<ISoldMeta> {
    const pool = await this.dbManager.getConnection(dbName);

    const [yearRows] = (await pool.query(
      `SELECT DISTINCT YEAR(\`sale_date\`) AS y
       FROM \`sold_car_prices\`
       WHERE \`sale_date\` IS NOT NULL
       ORDER BY y DESC`,
    )) as any[];

    const years = (yearRows ?? [])
      .map((row: any) => (row?.y ? String(row.y) : ''))
      .filter(Boolean);

    let activeYear = this.safeSoldYear(year) ?? '';
    if (!activeYear && years.length) activeYear = years[0];

    let months: string[] = [];
    if (activeYear) {
      const [monthRows] = (await pool.execute(
        `SELECT DISTINCT DATE_FORMAT(\`sale_date\`, '%m') AS m
         FROM \`sold_car_prices\`
         WHERE \`sale_date\` IS NOT NULL
           AND YEAR(\`sale_date\`) = ?
         ORDER BY m ASC`,
        [Number(activeYear)],
      )) as any[];

      months = (monthRows ?? [])
        .map((row: any) => (row?.m ? String(row.m) : ''))
        .filter(Boolean);
    }

    return {
      years,
      activeYear,
      months,
    };
  }

  async getSoldRows(
    dbName: string,
    input: {
      q?: string;
      year?: string;
      months?: string | string[];
      sort?: string;
      dir?: string;
      limit?: number;
      offset?: number;
    },
  ): Promise<ISoldRow[]> {
    const pool = await this.dbManager.getConnection(dbName);

    const q = this.normalizeString(input.q).slice(0, 200);
    const year = this.safeSoldYear(input.year);
    const months = this.safeSoldMonths(input.months);
    const sort = this.safeSoldSort(input.sort);
    const dir = this.safeSoldDir(input.dir);
    const limit = Math.min(Math.max(Number(input.limit ?? 200), 10), 2000);
    const offset = Math.max(Number(input.offset ?? 0), 0);

    const where = ['1=1'];
    const params: unknown[] = [];

    if (q) {
      where.push('(country LIKE ? OR brand LIKE ? OR model LIKE ? OR detail LIKE ?)');
      const like = `%${q}%`;
      params.push(like, like, like, like);
    }

    if (year) {
      where.push('sale_date IS NOT NULL AND YEAR(sale_date) = ?');
      params.push(Number(year));
    }

    if (months.length) {
      where.push(
        `sale_date IS NOT NULL AND DATE_FORMAT(sale_date, '%m') IN (${months.map(() => '?').join(',')})`,
      );
      params.push(...months);
    }

    const [rows] = (await pool.execute(
      `SELECT
         id,
         country,
         brand,
         model,
         detail,
         mileage_km,
         DATE_FORMAT(first_reg_date, '%d.%m.%Y') AS first_reg_fmt,
         sale_price,
         DATE_FORMAT(sale_date, '%d.%m.%Y') AS sale_date_fmt,
         sale_month
       FROM \`sold_car_prices\`
       WHERE ${where.join(' AND ')}
       ORDER BY \`${sort}\` ${dir}, \`id\` DESC
       LIMIT ${limit} OFFSET ${offset}`,
      params as any[],
    )) as any[];

    return (rows ?? []) as ISoldRow[];
  }

  // ===================== SOLD CSV IMPORT =====================

  private soldStripBom(s: string): string {
    return s.startsWith('\uFEFF') ? s.slice(1) : s.replace(/^\xEF\xBB\xBF/, '');
  }

  private soldDetectDelim(line: string): ',' | ';' | '\t' {
    const c = (line.match(/,/g) || []).length;
    const s = (line.match(/;/g) || []).length;
    const t = (line.match(/\t/g) || []).length;
    if (s >= c && s >= t) return ';';
    if (t >= c && t >= s) return '\t';
    return ',';
  }

  private soldNormStr(v: unknown): string {
    return String(v ?? '').trim().replace(/\s+/gu, ' ');
  }

  private soldParseMileage(v: unknown): number | null {
    let s = String(v ?? '');
    s = s.replace(/km/gi, '').replace(/\u00A0/g, '').replace(/\s+/g, '');
    s = s.replace(/[^\d]/g, '');
    if (!s) return null;
    const n = Number(s);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private soldParseMoney(v: unknown): number | null {
    let s = String(v ?? '').replace(/\u00A0/g, '').trim();
    if (!s) return null;

    s = s.replace(/\s+/g, '');
    s = s.replace(/€/g, '').replace(/EUR/gi, '').replace(/USD/gi, '').replace(/\$/g, '');

    const pDot = s.lastIndexOf('.');
    const pCom = s.lastIndexOf(',');

    if (pDot !== -1 && pCom !== -1) {
      if (pDot > pCom) {
        s = s.replace(/,/g, '');
      } else {
        s = s.replace(/\./g, '');
        s = s.replace(/,/g, '.');
      }
    } else {
      if (pCom !== -1 && pDot === -1) s = s.replace(/,/g, '.');
      s = s.replace(/,(?=\d{3}\b)/g, '');
    }

    s = s.replace(/[^0-9.\-]/g, '');
    if (!s || s === '-') return null;

    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }

  private soldParseDateAny(v: unknown): string | null {
    if (v === null || v === undefined) return null;
    const s = String(v).trim();
    if (!s) return null;

    if (/^\d+(\.\d+)?$/.test(s)) {
      const num = Number(s);
      if (num > 20000 && num < 90000) {
        const base = new Date(Date.UTC(1899, 11, 30));
        base.setUTCDate(base.getUTCDate() + Math.floor(num));
        return base.toISOString().slice(0, 10);
      }
    }

    const m1 = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
    if (m1) {
      const d = Number(m1[1]);
      const mo = Number(m1[2]);
      const y = Number(m1[3]);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
        return `${y.toString().padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    const m2 = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
    if (m2) {
      const y = Number(m2[1]);
      const mo = Number(m2[2]);
      const d = Number(m2[3]);
      const dt = new Date(Date.UTC(y, mo - 1, d));
      if (dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d) {
        return `${y.toString().padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      }
    }

    const parsed = new Date(s);
    return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString().slice(0, 10);
  }

  private soldHashRow(
    country: string,
    brand: string,
    model: string,
    mileage: number | null,
    firstReg: string | null,
    saleDate: string,
    salePrice: number,
  ): string {
    const raw = [
      country.trim().toLowerCase(),
      brand.trim().toLowerCase(),
      model.trim().toLowerCase(),
      String(mileage ?? ''),
      String(firstReg ?? ''),
      String(saleDate),
      String(salePrice),
    ].join('|');

    const crypto = require('crypto') as typeof import('crypto');
    return crypto.createHash('md5').update(raw).digest('hex');
  }

  private soldGuessCol(h: string):
    | 'country'
    | 'brand'
    | 'model'
    | 'detail'
    | 'mileage_km'
    | 'first_reg_date'
    | 'sale_price'
    | 'sale_date'
    | null {
    const key = h.toLowerCase().trim().replace(/[\s\t\r\n]+/g, '');

    if (['country', 'kraj', 'країна', 'krajpochodzenia'].includes(key)) return 'country';
    if (['brand', 'marka', 'марка'].includes(key)) return 'brand';
    if (['model', 'модель'].includes(key)) return 'model';
    if (['detail', 'opis', 'opisdetail', 'опис', 'детальнийопис', 'description'].includes(key)) return 'detail';
    if (['mileage', 'mileage_km', 'przebieg', 'пробіг', 'przebiegkm'].includes(key)) return 'mileage_km';
    if (['firstreg', 'first_reg', 'first_reg_date', 'pierwsza_rejestracja', 'перша_реєстрація', 'firstregistration'].includes(key)) return 'first_reg_date';
    if (['saleprice', 'sale_price', 'price', 'cena', 'ціна', 'цінапродажу'].includes(key)) return 'sale_price';
    if (['saledate', 'sale_date', 'datesale', 'data_sprzedazy', 'датапродажу'].includes(key)) return 'sale_date';

    return null;
  }

  private parseCsvLine(line: string, delimiter: string): string[] {
    const out: string[] = [];
    let cur = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i += 1) {
      const ch = line[i];
      const next = line[i + 1];

      if (ch === '"') {
        if (inQuotes && next === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (ch === delimiter && !inQuotes) {
        out.push(cur);
        cur = '';
        continue;
      }

      cur += ch;
    }

    out.push(cur);
    return out;
  }

  async importSoldCsv(
    dbName: string,
    file: Express.Multer.File,
    options: { updateExisting?: boolean } = {},
  ): Promise<{ ok: true; inserted: number; updated: number; skipped: number }> {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }

    const maxBytes = 8 * 1024 * 1024;
    if (file.size > maxBytes) {
      throw new BadRequestException('Файл занадто великий');
    }

    const updateExisting = Boolean(options.updateExisting);
    const text = file.buffer.toString('utf8');
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    const lines = normalized.split('\n').filter((line, index, arr) => !(index === arr.length - 1 && line === ''));

    if (!lines.length) {
      throw new BadRequestException('Порожній CSV файл');
    }

    const firstLine = this.soldStripBom(lines[0]);
    const delimiter = this.soldDetectDelim(firstLine);
    const headers = this.parseCsvLine(firstLine, delimiter);

    if (!headers.length || headers.length < 2) {
      throw new BadRequestException('Некоректний CSV заголовок');
    }

    const map: Record<string, number> = {};
    headers.forEach((header, index) => {
      const key = this.soldGuessCol(this.soldStripBom(String(header)));
      if (key && !(key in map)) map[key] = index;
    });

    const required = ['country', 'brand', 'model', 'sale_price', 'sale_date'];
    for (const key of required) {
      if (!(key in map)) {
        throw new BadRequestException(`Відсутня обов'язкова колонка: ${key}`);
      }
    }

    const pool = await this.dbManager.getConnection(dbName);
    const connection = typeof pool.getConnection === 'function' ? await pool.getConnection() : pool;

    let inserted = 0;
    let updated = 0;
    let skipped = 0;
    const errors: any[] = [];

    try {
      await connection.beginTransaction();

      for (let index = 1; index < lines.length; index += 1) {
        const rawLine = lines[index];
        const row = this.parseCsvLine(rawLine, delimiter);
        const lineNo = index + 1;

        const allEmpty = row.every((cell) => this.normalizeString(cell) === '');
        if (allEmpty) continue;

        const country = this.soldNormStr(row[map.country] ?? '');
        const brand = this.soldNormStr(row[map.brand] ?? '');
        const model = this.soldNormStr(row[map.model] ?? '');
        const detail = 'detail' in map ? this.soldNormStr(row[map.detail] ?? '') : '';
        const mileage = 'mileage_km' in map ? this.soldParseMileage(row[map.mileage_km]) : null;
        const firstReg = 'first_reg_date' in map ? this.soldParseDateAny(row[map.first_reg_date]) : null;
        const salePrice = this.soldParseMoney(row[map.sale_price]);
        const saleDate = this.soldParseDateAny(row[map.sale_date]);

        if (!country || !brand || !model || salePrice === null || saleDate === null) {
          errors.push({
            line: lineNo,
            error: 'Обов’язкові поля заповнені некоректно',
            country,
            brand,
            model,
            sale_price_raw: row[map.sale_price] ?? '',
            sale_date_raw: row[map.sale_date] ?? '',
          });
          continue;
        }

        const hash = this.soldHashRow(country, brand, model, mileage, firstReg, saleDate, salePrice);

        const [existingRows] = (await connection.execute(
          'SELECT id FROM `sold_car_prices` WHERE `import_hash` = ? LIMIT 1',
          [hash],
        )) as any[];

        const exists = Boolean(existingRows?.[0]?.id);

        if (!exists) {
          const [result] = (await connection.execute(
            `INSERT INTO \`sold_car_prices\`
              (\`country\`,\`brand\`,\`model\`,\`detail\`,\`mileage_km\`,\`first_reg_date\`,\`sale_price\`,\`sale_date\`,\`import_hash\`)
             VALUES (?,?,?,?,?,?,?,?,?)`,
            [country, brand, model, detail || null, mileage, firstReg, salePrice, saleDate, hash],
          )) as any[];

          if (!result?.affectedRows) {
            errors.push({ line: lineNo, error: 'Не вдалося вставити рядок' });
            continue;
          }
          inserted += 1;
        } else {
          if (!updateExisting) {
            skipped += 1;
            continue;
          }

          const [result] = (await connection.execute(
            `UPDATE \`sold_car_prices\`
                SET \`country\` = ?,
                    \`brand\` = ?,
                    \`model\` = ?,
                    \`detail\` = ?,
                    \`mileage_km\` = ?,
                    \`first_reg_date\` = ?,
                    \`sale_price\` = ?,
                    \`sale_date\` = ?,
                    \`updated_at\` = CURRENT_TIMESTAMP
              WHERE \`import_hash\` = ?`,
            [country, brand, model, detail || null, mileage, firstReg, salePrice, saleDate, hash],
          )) as any[];

          if (!result?.affectedRows) {
            errors.push({ line: lineNo, error: 'Не вдалося оновити рядок' });
            continue;
          }
          updated += 1;
        }
      }

      if (errors.length) {
        await connection.rollback();
        throw new BadRequestException({
          ok: false,
          error: 'Імпорт скасовано через помилки. Зміни відкотилися.',
          inserted,
          updated,
          skipped,
          errors,
        });
      }

      await connection.commit();
      return { ok: true, inserted, updated, skipped };
    } catch (error) {
      try {
        await connection.rollback();
      } catch {
        // ignore rollback error
      }
      throw error;
    } finally {
      if (connection && connection !== pool) {
        // @ts-ignore
        if (typeof connection.release === 'function') {
          (connection as any).release();
        }
      }
    }
  }
}
