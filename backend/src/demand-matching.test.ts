import { describe, expect, it } from 'vitest';
import { matchesDemandCriteria, type DemandCriteria, type MatchRequest } from './demand-matching.js';

const criteria: DemandCriteria = { countryCode: null, region: null, settlementCodes: [], center: null, radiusKm: null,
  minQuantity: null, maxQuantity: null, unit: null, minPrice: null, maxPrice: null, currency: null, receiptMethods: ['SELF_PICKUP', 'SELLER_DELIVERY'] };
const demand: MatchRequest = { countryCode: 'UA', region: 'Рівненська область', settlementCode: 'rivne', publicPoint: { latitude: 50.61, longitude: 26.21 },
  quantity: 20, unit: 'kg', minPrice: 150, maxPrice: 200, currency: 'UAH', receiptMethod: 'SELLER_DELIVERY' };
const match = (subscription: Partial<DemandCriteria> = {}, request: Partial<MatchRequest> = {}) => matchesDemandCriteria({ ...criteria, countryCode: subscription.region || subscription.settlementCodes ? null : 'UA', ...subscription }, { ...demand, ...request });

describe('demand matching semantics', () => {
  it('allows the category/country minimum without optional criteria', () => expect(match({countryCode: 'UA'}, { quantity: null, minPrice: null, maxPrice: null, receiptMethod: null })).toBe(true));
  it('fails closed on an unknown selected geography', () => { expect(match({countryCode: 'UA'}, { countryCode: null })).toBe(false); expect(match({ region: 'Рівненська область' }, { region: null })).toBe(false); });
  it('combines criteria with AND and cities with OR', () => {
    expect(match({ settlementCodes: ['rivne', 'kyiv'], minQuantity: 10, maxQuantity: 50, unit: 'kg', minPrice: 170, currency: 'UAH', receiptMethods: ['SELLER_DELIVERY'] })).toBe(true);
    expect(match({ settlementCodes: ['kyiv'], minQuantity: 10, unit: 'kg' })).toBe(false);
    expect(match({ settlementCodes: ['rivne'], minQuantity: 30, unit: 'kg' })).toBe(false);
  });
  it.each([9, 51, null])('does not match incompatible or missing quantity %s', quantity => expect(match({ minQuantity: 10, maxQuantity: 50, unit: 'kg' }, { quantity })).toBe(false));
  it.each([10, 20, 50])('includes quantity boundaries %s', quantity => expect(match({ minQuantity: 10, maxQuantity: 50, unit: 'kg' }, { quantity })).toBe(true));
  it('converts kg/ton in both directions without converting boxes, pieces or litres', () => {
    expect(match({ minQuantity: 10, maxQuantity: 50, unit: 'kg' }, { quantity: 0.02, unit: 'ton' })).toBe(true);
    expect(match({ minQuantity: 0.01, maxQuantity: 0.05, unit: 'ton' })).toBe(true);
    expect(match({ minQuantity: 1, unit: 'litre' })).toBe(false);
    expect(match({ unit: 'piece' }, { unit: 'box' })).toBe(false);
    expect(match({ unit: 'kg' }, { unit: null })).toBe(false);
  });
  it('matches overlapping budgets including exact prices and one-sided budgets', () => {
    for (const request of [{ minPrice: 180, maxPrice: 180 }, { minPrice: null, maxPrice: 170 }, { minPrice: 190, maxPrice: null }]) {
      expect(match({ minPrice: 170, maxPrice: 190, unit: 'kg', currency: 'UAH' }, request)).toBe(true);
    }
    expect(match({ minPrice: 170, unit: 'kg', currency: 'UAH' }, { maxPrice: 169 })).toBe(false);
    expect(match({ maxPrice: 140, unit: 'kg', currency: 'UAH' })).toBe(false);
  });
  it('accepts unknown budgets for price filters but retains unit and known-currency compatibility', () => {
    const price = { minPrice: 170, unit: 'kg', currency: 'UAH' };
    expect(match(price, { minPrice: null, maxPrice: null })).toBe(true);
    expect(match({...price,maxPrice:190}, { minPrice: null, maxPrice: null, currency:'EUR' })).toBe(true);
    expect(match({...price,minQuantity:30}, { minPrice:null,maxPrice:null })).toBe(false);
    expect(match(price, { minPrice: null, maxPrice: null, unit:'piece' })).toBe(false);
    expect(match(price, { currency: 'EUR' })).toBe(false);
    expect(match(price, { unit: 'piece' })).toBe(false);
    expect(match({ currency: 'UAH' }, { currency: 'EUR' })).toBe(false);
  });
  it('converts per-unit prices inversely to quantity', () => {
    expect(match({ minPrice: 170, maxPrice: 190, unit: 'kg', currency: 'UAH' }, { unit: 'ton', minPrice: 180000, maxPrice: 180000 })).toBe(true);
    expect(match({ minPrice: 170000, maxPrice: 190000, unit: 'ton', currency: 'UAH' }, { minPrice: 180, maxPrice: 180 })).toBe(true);
    expect(match({ minPrice: 170, unit: 'kg', currency: 'UAH' }, { unit: 'ton', minPrice: 160000, maxPrice: 160000 })).toBe(false);
  });
  it('requires an explicit compatible receipt method when selected', () => {
    expect(match({ receiptMethods: ['SELF_PICKUP'] })).toBe(false);
    expect(match({ receiptMethods: ['SELF_PICKUP'] }, { receiptMethod: 'SELF_PICKUP' })).toBe(true);
    expect(match({ receiptMethods: ['SELF_PICKUP','SELLER_DELIVERY'] })).toBe(true);
    expect(match({ receiptMethods: ['SELLER_DELIVERY'] }, { receiptMethod: null })).toBe(false);
    expect(match({}, { receiptMethod: null })).toBe(true);
  });
  it('country and region include descendants while geography uses a union', () => {
    expect(match({countryCode:'UA'}, {region:'Волинська область', settlementCode:'lutsk'})).toBe(true);
    expect(match({countryCode:null, region:'Рівненська область'}, {settlementCode:'dubno'})).toBe(true);
    expect(match({countryCode:null, region:'Рівненська область', settlementCodes:['kyiv']}, {region:'місто Київ',settlementCode:'kyiv'})).toBe(true);
    expect(match({countryCode:null, region:'Рівненська область', settlementCodes:['kyiv']}, {region:'Волинська область',settlementCode:'lutsk'})).toBe(false);
  });
  it('unrestricted unit and currency do not filter unknown or differing data', () => {
    expect(match({}, {unit:'box',currency:'EUR',quantity:null,minPrice:null,maxPrice:null})).toBe(true);
    expect(match({}, {unit:null,currency:null})).toBe(true);
  });
  it('compares converted decimal boundaries exactly, with adjacent nonmatches', () => {
    const amount = {minQuantity:1001,maxQuantity:1001,unit:'kg'};
    expect(match(amount,{quantity:1.001,unit:'ton'})).toBe(true);
    expect(match(amount,{quantity:1.0009,unit:'ton'})).toBe(false);
    expect(match(amount,{quantity:1.0011,unit:'ton'})).toBe(false);
    expect(match({minQuantity:1.001,maxQuantity:1.001,unit:'ton'},{quantity:1001})).toBe(true);
    const price = {minPrice:350,maxPrice:350,unit:'ton',currency:'UAH'};
    expect(match(price,{minPrice:0.35,maxPrice:0.35})).toBe(true);
    expect(match(price,{minPrice:0.3499,maxPrice:0.3499})).toBe(false);
    expect(match(price,{minPrice:0.3501,maxPrice:0.3501})).toBe(false);
    expect(match(price,{currency:'EUR',minPrice:0.35,maxPrice:0.35})).toBe(false);
    expect(match({minPrice:0.35,maxPrice:0.35,unit:'kg',currency:'UAH'},{unit:'ton',minPrice:350,maxPrice:350})).toBe(true);
    expect(match({minQuantity:0.0001,maxQuantity:0.0001,unit:'kg'},{quantity:1e-7,unit:'ton'})).toBe(true);
  });
  it('preferred delivery accepts both single methods but strict seller delivery rejects pickup', () => {
    for (const receiptMethods of [['SELF_PICKUP'],['SELLER_DELIVERY'],['SELF_PICKUP','SELLER_DELIVERY']] as DemandCriteria['receiptMethods'][]) {
      expect(match({receiptMethods},{receiptMethod:null,deliveryPreferred:true})).toBe(true);
    }
    expect(match({receiptMethods:['SELF_PICKUP']},{receiptMethod:'SELLER_DELIVERY',deliveryPreferred:false})).toBe(false);
  });
  it('extends any selected city from its boundary using only public points', () => {
    const ring = [{latitude:0,longitude:0},{latitude:0,longitude:1},{latitude:1,longitude:1},{latitude:1,longitude:0},{latitude:0,longitude:0}];
    const suburbs = {countryCode:null,settlementCodes:['first','second'],cityOutsideKm:1,settlementBoundaries:{second:{rings:[ring],maxDistanceKm:0}}};
    expect(match(suburbs,{settlementCode:'second',publicPoint:null})).toBe(true);
    expect(match(suburbs,{settlementCode:'other',publicPoint:{latitude:0.5,longitude:1.005}})).toBe(true);
    expect(match(suburbs,{settlementCode:'other',publicPoint:{latitude:0.5,longitude:1.02}})).toBe(false);
    expect(match(suburbs,{settlementCode:'other',publicPoint:null})).toBe(false);
    expect(match({...suburbs,cityOutsideKm:null},{settlementCode:'other',publicPoint:{latitude:0.5,longitude:1.005}})).toBe(false);
    expect(match({...suburbs,settlementBoundaries:{}},{settlementCode:'other',publicPoint:{latitude:0.5,longitude:1.005}})).toBe(false);
  });
  it('uses public-point radius and rejects missing points', () => {
    const radius = { center: demand.publicPoint, radiusKm: 1 };
    expect(match(radius)).toBe(true);
    expect(match(radius, { publicPoint: { latitude: 50.45, longitude: 30.52 } })).toBe(false);
    expect(match(radius, { publicPoint: null })).toBe(false);
  });
});

it('matches any selected country, region or city without intersecting territories', () => {
  const selected = { ...criteria, countryCodes: ['PL', 'DE'], regions: ['Рівненська область', 'Київ'], settlementCodes: ['lutsk'] };
  for (const request of [{ countryCode: 'PL', region: null, settlementCode: null }, { countryCode: 'DE', region: null, settlementCode: null }, { countryCode: 'UA', region: 'Рівненська область', settlementCode: 'rivne' }, { countryCode: 'UA', region: 'Київ', settlementCode: 'kyiv' }, { countryCode: 'UA', region: 'Волинська область', settlementCode: 'lutsk' }]) expect(matchesDemandCriteria(selected, { ...demand, ...request })).toBe(true);
  expect(matchesDemandCriteria(selected, { ...demand, countryCode: 'US', region: null, settlementCode: null })).toBe(false);
});
