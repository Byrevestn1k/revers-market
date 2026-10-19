import { distanceKm } from './city-boundaries.js';
import type { MapPoint } from './map-service.js';
import { getSettlement, listSettlementRegions } from './settlements.js';

export const DELIVERY_METHODS = ['SELF_PICKUP', 'SELLER_DELIVERY', 'POSTAL_DELIVERY', 'FLEXIBLE'] as const;
export type DeliveryMethod = typeof DELIVERY_METHODS[number];
export type DeliveryStatus = 'EXACT_MATCH' | 'POSSIBLE_AGREEMENT' | 'NO_MATCH' | 'UNKNOWN';
export type DeliveryOption = {
  method: DeliveryMethod;
  radiusKm?: number;
  region?: string;
  regions?: string[];
  nationwide?: boolean;
  place?: DeliveryPlace;
};
export type DeliveryPlace = { settlementCode: string | null; region: string | null; publicPoint: MapPoint | null; verifiedPoint?: boolean };
export type DeliveryParty = { options: DeliveryOption[] | null; place: DeliveryPlace };
export type DeliveryMatch = { status: DeliveryStatus; methods: DeliveryMethod[] };

const regions = new Set(listSettlementRegions().regions);
// A private public point may be rounded to 0.01 degrees. Two rounded points can
// shift their relative distance by roughly 1.3 km; keep threshold cases unknown.
const PUBLIC_POINT_UNCERTAINTY_KM = 1.5;
const radiusStatus = (a: MapPoint, b: MapPoint, radiusKm: number): DeliveryStatus => {
  const distance = distanceKm(a, b);
  if (!Number.isFinite(distance)) return 'UNKNOWN';
  if (distance + PUBLIC_POINT_UNCERTAINTY_KM <= radiusKm) return 'EXACT_MATCH';
  if (distance - PUBLIC_POINT_UNCERTAINTY_KM > radiusKm) return 'NO_MATCH';
  return 'UNKNOWN';
};

export function validateDeliveryOptions(value: unknown, role: 'buyer' | 'seller'): value is DeliveryOption[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) return false;
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item) || !DELIVERY_METHODS.includes(item.method)) return false;
    if (seen.has(item.method)) return false;
    seen.add(item.method);
    const allowed = item.method === 'SELF_PICKUP' && role === 'buyer' ? ['method', 'radiusKm', 'region']
      : item.method === 'SELF_PICKUP' && role === 'seller' ? ['method', 'place']
      : item.method === 'SELLER_DELIVERY' && role === 'seller' ? ['method', 'radiusKm', 'regions', 'place']
      : item.method === 'POSTAL_DELIVERY' && role === 'seller' ? ['method', 'nationwide', 'regions'] : ['method'];
    if (Object.keys(item).some(key => !allowed.includes(key))) return false;
    // A zero-radius public point cannot prove that two private locations are
    // identical. New radius rules therefore start at one kilometre; existing
    // zero-radius records remain readable and are handled conservatively below.
    if (item.radiusKm !== undefined && (typeof item.radiusKm !== 'number' || !Number.isFinite(item.radiusKm) || item.radiusKm < 1 || item.radiusKm > 500)) return false;
    if (item.region !== undefined && !regions.has(item.region)) return false;
    if (item.regions !== undefined && (!Array.isArray(item.regions) || !item.regions.length || item.regions.length > 30
      || item.regions.some((region: unknown) => !regions.has(region as string)) || new Set(item.regions).size !== item.regions.length)) return false;
    if (item.nationwide !== undefined && item.nationwide !== true) return false;
    if (item.place !== undefined) {
      const place = item.place as DeliveryPlace;
      if (!place || typeof place !== 'object' || Array.isArray(place) || Object.keys(place).some(key => !['settlementCode', 'region', 'publicPoint'].includes(key))
        || place.settlementCode !== null && typeof place.settlementCode !== 'string'
        || place.region !== null && !regions.has(place.region)
        || place.settlementCode !== null && (!getSettlement(place.settlementCode) || getSettlement(place.settlementCode)?.region !== place.region)
        || place.publicPoint !== null && (!place.publicPoint || !Number.isFinite(place.publicPoint.latitude) || !Number.isFinite(place.publicPoint.longitude)
          || Math.abs(place.publicPoint.latitude) > 90 || Math.abs(place.publicPoint.longitude) > 180
          || Math.abs(place.publicPoint.latitude * 100 - Math.round(place.publicPoint.latitude * 100)) > 0.000001
          || Math.abs(place.publicPoint.longitude * 100 - Math.round(place.publicPoint.longitude * 100)) > 0.000001)) return false;
    }
    if (item.method === 'SELF_PICKUP' && role === 'buyer' && item.radiusKm === undefined && item.region === undefined) return false;
    if (item.method === 'SELLER_DELIVERY' && role === 'seller' && item.radiusKm === undefined && item.regions === undefined) return false;
    if (item.method === 'POSTAL_DELIVERY' && role === 'seller' && !item.nationwide && !item.regions?.length) return false;
    if (item.radiusKm !== undefined && (item.region || item.regions)) return false;
    if (item.nationwide && item.regions) return false;
  }
  return true;
}

function compatible(method: DeliveryMethod, buyer: DeliveryOption, seller: DeliveryOption, buyerPlace: DeliveryPlace, sellerPlace: DeliveryPlace): DeliveryStatus {
  if (method === 'SELF_PICKUP') {
    if (buyer.region && sellerPlace.region) return buyer.region === sellerPlace.region ? 'EXACT_MATCH' : 'NO_MATCH';
    if (buyer.region) return 'UNKNOWN';
    if (buyer.radiusKm !== undefined) {
      if (!buyerPlace.publicPoint || !sellerPlace.publicPoint) return 'UNKNOWN';
      if (!buyerPlace.verifiedPoint || !sellerPlace.verifiedPoint) return 'UNKNOWN';
      return radiusStatus(buyerPlace.publicPoint, sellerPlace.publicPoint, buyer.radiusKm);
    }
  }
  if (method === 'SELLER_DELIVERY') {
    if (seller.regions?.length && buyerPlace.region) return seller.regions.includes(buyerPlace.region) ? 'EXACT_MATCH' : 'NO_MATCH';
    if (seller.regions?.length) return 'UNKNOWN';
    if (seller.radiusKm !== undefined) {
      if (!sellerPlace.publicPoint || !buyerPlace.publicPoint) return 'UNKNOWN';
      if (!sellerPlace.verifiedPoint || !buyerPlace.verifiedPoint) return 'UNKNOWN';
      return radiusStatus(sellerPlace.publicPoint, buyerPlace.publicPoint, seller.radiusKm);
    }
  }
  if (method === 'POSTAL_DELIVERY') {
    if (!buyerPlace.region) return 'UNKNOWN';
    return seller.nationwide || seller.regions?.includes(buyerPlace.region) ? 'EXACT_MATCH' : 'NO_MATCH';
  }
  return 'UNKNOWN';
}

export function matchDelivery(buyer: DeliveryParty, seller: DeliveryParty): DeliveryMatch {
  if (!buyer.options || !seller.options) return { status: 'UNKNOWN', methods: [] };
  const exact: DeliveryMethod[] = [];
  let unknown = false;
  for (const buyerOption of buyer.options) {
    if (buyerOption.method === 'FLEXIBLE') continue;
    const sellerOption = seller.options.find(option => option.method === buyerOption.method);
    if (!sellerOption) continue;
    const result = compatible(buyerOption.method, buyerOption, sellerOption, buyer.place, sellerOption.place ?? seller.place);
    if (result === 'EXACT_MATCH') exact.push(buyerOption.method);
    if (result === 'UNKNOWN') unknown = true;
  }
  if (exact.length) return { status: 'EXACT_MATCH', methods: exact };
  if (buyer.options.some(option => option.method === 'FLEXIBLE') || seller.options.some(option => option.method === 'FLEXIBLE')) return { status: 'POSSIBLE_AGREEMENT', methods: [] };
  return { status: unknown ? 'UNKNOWN' : 'NO_MATCH', methods: [] };
}
