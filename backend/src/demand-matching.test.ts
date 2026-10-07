import { describe, expect, it } from 'vitest';
import { matchesDemandCriteria, type DemandCriteria, type MatchRequest } from './demand-matching.js';

const criteria: DemandCriteria = { countryCode: 'UA', region: null, settlementCodes: [], center: null, radiusKm: null,
  minQuantity: null, maxQuantity: null, unit: null, minPrice: null, maxPrice: null, currency: null, receiptMethods: [] };
const demand: MatchRequest = { countryCode: 'UA', region: 'Рівненська область', settlementCode: 'rivne', publicPoint: { latitude: 50.61, longitude: 26.21 },
  quantity: 20, unit: 'kg', minPrice: 150, maxPrice: 200, currency: 'UAH', receiptMethod: 'SELLER_DELIVERY' };
const match = (subscription: Partial<DemandCriteria> = {}, request: Partial<MatchRequest> = {}) => matchesDemandCriteria({ ...criteria, ...subscription }, { ...demand, ...request });

describe('demand matching semantics', () => {
  it('allows the category/country minimum without optional criteria', () => expect(match({}, { quantity: null, minPrice: null, maxPrice: null, receiptMethod: null })).toBe(true));
  it('fails closed on an unknown selected geography', () => { expect(match({}, { countryCode: null })).toBe(false); expect(match({ region: 'Рівненська область' }, { region: null })).toBe(false); });
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
  it('rejects unknown prices for a price filter and incompatible currency/unit', () => {
    const price = { minPrice: 170, unit: 'kg', currency: 'UAH' };
    expect(match(price, { minPrice: null, maxPrice: null })).toBe(false);
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
  it('uses public-point radius and rejects missing points', () => {
    const radius = { center: demand.publicPoint, radiusKm: 1 };
    expect(match(radius)).toBe(true);
    expect(match(radius, { publicPoint: { latitude: 50.45, longitude: 30.52 } })).toBe(false);
    expect(match(radius, { publicPoint: null })).toBe(false);
  });
});
