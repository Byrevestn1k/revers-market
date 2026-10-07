import { distanceKm } from './city-boundaries.js';
import type { MapPoint } from './map-service.js';

export const RECEIPT_METHODS = ['SELF_PICKUP', 'SELLER_DELIVERY'] as const;
export type ReceiptMethod = typeof RECEIPT_METHODS[number];
export type DemandCriteria = {
  countryCode: string | null;
  region: string | null;
  settlementCodes: string[];
  center: MapPoint | null;
  radiusKm: number | null;
  minQuantity: number | null;
  maxQuantity: number | null;
  unit: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string | null;
  receiptMethods: ReceiptMethod[];
};
export type MatchRequest = {
  countryCode: string | null;
  region: string | null;
  settlementCode: string | null;
  publicPoint: MapPoint | null;
  quantity: number | null;
  unit: string | null;
  minPrice: number | null;
  maxPrice: number | null;
  currency: string | null;
  receiptMethod: ReceiptMethod | null;
};

const factors: Record<string, number> = { kg: 1, ton: 1000 };
const unitRatio = (from: string | null, to: string) => from === to ? 1 : from && factors[from] && factors[to] ? factors[from] / factors[to] : null;
const known = (value: number | null): value is number => value !== null && Number.isFinite(value);

// Category, active state, owner exclusion and creation time are filtered in SQL.
// All remaining criteria are AND; the city and receipt-method lists are each OR.
export function matchesDemandCriteria(criteria: DemandCriteria, request: MatchRequest): boolean {
  if (criteria.countryCode && request.countryCode !== criteria.countryCode) return false;
  if (criteria.region && request.region !== criteria.region) return false;
  if (criteria.settlementCodes.length && (!request.settlementCode || !criteria.settlementCodes.includes(request.settlementCode))) return false;
  if (criteria.radiusKm !== null) {
    if (!criteria.center || !request.publicPoint) return false;
    const distance = distanceKm(criteria.center, request.publicPoint);
    if (!Number.isFinite(distance) || distance > criteria.radiusKm) return false;
  }
  if (criteria.currency && request.currency !== criteria.currency) return false;

  const quantityFilter = criteria.minQuantity !== null || criteria.maxQuantity !== null;
  const priceFilter = criteria.minPrice !== null || criteria.maxPrice !== null;
  const ratio = criteria.unit ? unitRatio(request.unit, criteria.unit) : 1;
  if (criteria.unit && ratio === null) return false;
  if (quantityFilter) {
    if (!known(request.quantity) || request.quantity <= 0 || ratio === null) return false;
    const quantity = request.quantity * ratio;
    if (criteria.minQuantity !== null && quantity < criteria.minQuantity) return false;
    if (criteria.maxQuantity !== null && quantity > criteria.maxQuantity) return false;
  }
  if (priceFilter) {
    if (request.currency !== criteria.currency || ratio === null || (!known(request.minPrice) && !known(request.maxPrice))) return false;
    // Prices are per Request unit, so their conversion is inverse to quantity.
    const min = known(request.minPrice) ? request.minPrice / ratio : -Infinity;
    const max = known(request.maxPrice) ? request.maxPrice / ratio : Infinity;
    if (min > max || min < 0 && min !== -Infinity || max < 0) return false;
    if (criteria.minPrice !== null && max < criteria.minPrice) return false;
    if (criteria.maxPrice !== null && min > criteria.maxPrice) return false;
  }
  if (criteria.receiptMethods.length && (!request.receiptMethod || !criteria.receiptMethods.includes(request.receiptMethod))) return false;
  return true;
}
