import { describe, expect, it } from 'vitest';
import { CURRENCIES, listingPrice, requestBudget } from './listing-options';

describe('listing currency', () => {
  it('offers USD and displays its original amount with a dollar sign', () => {
    expect(CURRENCIES).toContain('USD');
    expect(listingPrice(100, 'USD')).toBe('100 $');
    expect(requestBudget({ min: 100, max: 100, currency: 'USD' })).toBe('100 $');
    expect(listingPrice(100, 'UAH')).toBe('100 UAH');
  });
});
