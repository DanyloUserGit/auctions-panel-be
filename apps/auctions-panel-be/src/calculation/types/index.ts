export type CustomsTableId = '27031' | '27032' | '27033';
export type FuelType = 'petrol' | 'diesel' | 'electric' | 'unknown';
export type CalculationTab = 'customs' | 'finalCost' | 'tables' | 'sold';

export interface ISelectOption {
  value: string;
  label: string;
}

export interface IRozmitnenniaForm {
  table: CustomsTableId | '';
  marka: string;
  model: string;
  typ: string;
  year: string;
  param: string;
  delivery: string;
  fx: string;
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
  [year: string]: string | number | null;
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
  detail: string;
  mileage_km: number | null;
  first_reg_fmt: string | null;
  sale_price: number | string | null;
  sale_date_fmt?: string | null;
  sale_month: string | null;
}

export interface ISimpleCalcForm {
  carYear: string;
  carBrand: string;
  carModel: string;
  carLink: string;
  stavka: number;
  aukcion: number;
  dostavka: number;
  dodatkovi: number;
  nashi: number;
  kurs: number;
  rozmitn: number;
  doroga: number;
  sertif: number;
  kordon: number;
  laveta: number;
}

export interface ISimpleCalcResult {
  carName: string;
  sumEUR: number;
  eur05: number;
  usd: number;
  uaTotal: number;
  summaryText: string;
}

export interface ICalculationForm {
  table: CustomsTableId;
  marka: string;
  model: string;
  typ: string;
  year: string;
  auctionPrice: number;
  engineVolume: number;
  fuelType: 'petrol' | 'diesel';
  road: number;
  cert: number;
  border: number;
  towing: number;
}

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
}

export interface IRozmitnenniaEstimateRequest {
  table: CustomsTableId;
  marka: string;
  model: string;
  typ: string;
  year: string;
  param: number;
  delivery?: number;
  fx: number;
}

export interface IRozmitnenniaEstimateResponse {
  table: CustomsTableId;
  marka: string;
  model: string;
  typ: string;
  year: string;
  basePrice: number;
  basePriceCurrency: 'EUR' | 'USD';
  basePriceEUR: number;
  basePriceUSD: number;
  customsValueEUR: number;
  customsValueUSD: number;
  deliveryEUR: number;
  deliveryUSD: number;
  fx: number;
  mode: 'europe' | 'nonEurope' | 'electric';
  parameterLabel: 'engineVolume' | 'batteryCapacity';
  parameterValue: number;
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
