import { describe, expect, it } from 'vitest';
import { matchDelivery, validateDeliveryOptions, type DeliveryOption, type DeliveryPlace } from './delivery-compatibility.js';

const rivne: DeliveryPlace = { settlementCode: 'UA56060470010041018', region: 'Рівненська область', publicPoint: { latitude: 50.62, longitude: 26.25 }, verifiedPoint: true };
const lutsk: DeliveryPlace = { settlementCode: null, region: 'Волинська область', publicPoint: { latitude: 50.75, longitude: 25.33 }, verifiedPoint: true };
const unknown: DeliveryPlace = { settlementCode: null, region: null, publicPoint: null };
const buyer = (options: DeliveryOption[], place = rivne) => ({ options, place });
const seller = (options: DeliveryOption[], place = rivne) => ({ options, place });

describe('delivery compatibility', () => {
  it('checks pickup with geographic kilometres and regions', () => {
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', radiusKm: 50 }]), seller([{ method: 'SELF_PICKUP' }])).status).toBe('EXACT_MATCH');
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', radiusKm: 10 }]), seller([{ method: 'SELF_PICKUP' }], lutsk)).status).toBe('NO_MATCH');
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', region: 'Рівненська область' }]), seller([{ method: 'SELF_PICKUP' }], lutsk)).status).toBe('NO_MATCH');
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', radiusKm: 50 }], unknown), seller([{ method: 'SELF_PICKUP' }])).status).toBe('UNKNOWN');
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', radiusKm: 1 }]), seller([{ method: 'SELF_PICKUP' }])).status).toBe('UNKNOWN');
  });

  it('checks seller delivery reach independently from pickup reach', () => {
    expect(matchDelivery(buyer([{ method: 'SELLER_DELIVERY' }]), seller([{ method: 'SELLER_DELIVERY', radiusKm: 20 }])).status).toBe('EXACT_MATCH');
    expect(matchDelivery(buyer([{ method: 'SELLER_DELIVERY' }]), seller([{ method: 'SELLER_DELIVERY', radiusKm: 20 }], lutsk)).status).toBe('NO_MATCH');
    expect(matchDelivery(buyer([{ method: 'SELLER_DELIVERY' }], unknown), seller([{ method: 'SELLER_DELIVERY', radiusKm: 20 }])).status).toBe('UNKNOWN');
  });

  it('does not trust old unverified coordinates even when they coincide', () => {
    const corrupt = { ...rivne, publicPoint: { latitude: 0, longitude: 0 }, verifiedPoint: false };
    expect(matchDelivery(buyer([{ method: 'SELLER_DELIVERY' }], corrupt), seller([{ method: 'SELLER_DELIVERY', radiusKm: 10 }], corrupt)).status).toBe('UNKNOWN');
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', radiusKm: 0 }], corrupt), seller([{ method: 'SELF_PICKUP' }], corrupt)).status).toBe('UNKNOWN');
    expect(matchDelivery(buyer([{ method: 'POSTAL_DELIVERY' }], corrupt), seller([{ method: 'POSTAL_DELIVERY', nationwide: true }])).status).toBe('EXACT_MATCH');
  });

  it('checks postal regions and prefers any real exact method', () => {
    expect(matchDelivery(buyer([{ method: 'POSTAL_DELIVERY' }]), seller([{ method: 'POSTAL_DELIVERY', nationwide: true }])).status).toBe('EXACT_MATCH');
    expect(matchDelivery(buyer([{ method: 'POSTAL_DELIVERY' }]), seller([{ method: 'POSTAL_DELIVERY', regions: ['Волинська область'] }])).status).toBe('NO_MATCH');
    expect(matchDelivery(buyer([{ method: 'POSTAL_DELIVERY' }], unknown), seller([{ method: 'POSTAL_DELIVERY', nationwide: true }])).status).toBe('UNKNOWN');
    expect(matchDelivery(buyer([{ method: 'SELF_PICKUP', radiusKm: 0 }, { method: 'POSTAL_DELIVERY' }]), seller([{ method: 'SELF_PICKUP' }, { method: 'POSTAL_DELIVERY', nationwide: true }])).methods).toEqual(['SELF_PICKUP', 'POSTAL_DELIVERY']);
  });

  it('keeps flexibility separate from confirmed compatibility', () => {
    expect(matchDelivery(buyer([{ method: 'POSTAL_DELIVERY' }]), seller([{ method: 'SELF_PICKUP' }, { method: 'FLEXIBLE' }])).status).toBe('POSSIBLE_AGREEMENT');
    expect(matchDelivery(buyer([{ method: 'POSTAL_DELIVERY' }]), seller([{ method: 'SELF_PICKUP' }])).status).toBe('NO_MATCH');
    expect(matchDelivery({ options: null, place: rivne }, seller([{ method: 'FLEXIBLE' }])).status).toBe('UNKNOWN');
  });

  it('rejects incomplete or overlapping geographic options', () => {
    expect(validateDeliveryOptions([{ method: 'POSTAL_DELIVERY' }], 'seller')).toBe(false);
    expect(validateDeliveryOptions([{ method: 'SELLER_DELIVERY', radiusKm: 20, regions: ['Рівненська область'] }], 'seller')).toBe(false);
    expect(validateDeliveryOptions([{ method: 'SELF_PICKUP', radiusKm: -1 }], 'buyer')).toBe(false);
    expect(validateDeliveryOptions([{ method: 'POSTAL_DELIVERY', nationwide: true }], 'seller')).toBe(true);
  });
});
