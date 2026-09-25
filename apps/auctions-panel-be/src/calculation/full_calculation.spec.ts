import { CalculationService } from './full_calculation.service';

// Ставки розмитнення за кодом замовника rozrahunok (2).tpl ([?16]).
describe('CalculationService.calculateFullEstimate', () => {
  const service = new CalculationService({} as any);
  const base = { basePriceFromDb: 10000, deliveryCost: 0, eurToUsd: 1.1, road: 0, cert: 0, border: 0, towing: 0 };

  it('27031: two variants - without certificate (10 %, broker 300 $) and with it (0 %, broker 1100 $)', () => {
    const result = service.calculateFullEstimate({ ...base, table: '27031', engineVolume: 2000, year: new Date().getFullYear() - 5, fuelType: 'diesel' } as any);
    const [noCert, cert] = result.cards;
    expect(result.basePriceFromDb).toBe(11000); // EUR → USD
    expect(noCert).toMatchObject({ code: 'no-cert', dutyUSD: 1100, brokerUSD: 300 });
    expect(cert).toMatchObject({ code: 'cert', dutyUSD: 0, brokerUSD: 1100 });
    // ПДВ 20 % від «авто + акциз + мито».
    expect(noCert.vatUSD).toBe(Math.round((11000 + 1100 + noCert.exciseUSD) * 0.2));
    expect(cert.vatUSD).toBe(Math.round((11000 + cert.exciseUSD) * 0.2));
  });

  it('diesel and petrol excise differ', () => {
    const args = { ...base, table: '27032', engineVolume: 2000, year: new Date().getFullYear() - 5 } as any;
    const diesel = service.calculateFullEstimate({ ...args, fuelType: 'diesel' });
    const petrol = service.calculateFullEstimate({ ...args, fuelType: 'petrol' });
    expect(diesel.details.excise).not.toBe(petrol.details.excise);
  });

  it('27033: electric - duty 0, excise 1 € per kWh, broker 300 $', () => {
    const result = service.calculateFullEstimate({ ...base, table: '27033', batteryCapacity: 60, year: 2022, fuelType: 'electric' } as any);
    expect(result.cards).toHaveLength(1);
    expect(result.cards[0]).toMatchObject({ dutyUSD: 0, exciseUSD: 66, brokerUSD: 300 });
  });
});
