import { distanceKm, withinCityOrDistance, type CityBoundary } from './city-boundaries.js';
import type { MapPoint } from './map-service.js';

export const RECEIPT_METHODS = ['SELF_PICKUP', 'SELLER_DELIVERY'] as const;
export type ReceiptMethod = typeof RECEIPT_METHODS[number];
export type DemandCriteria = {
  countryCode: string | null;
  region: string | null;
  countryCodes?: string[];
  regions?: string[];
  settlementCodes: string[];
  center: MapPoint | null;
  radiusKm: number | null;
  cityOutsideKm?: number | null;
  settlementBoundaries?: Record<string, CityBoundary>;
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
  deliveryPreferred?: boolean;
};

const factors: Record<string, bigint> = { kg: 1n, ton: 1000n };
const unitRatio = (from: string | null, to: string): [bigint, bigint] | null => from === to ? [1n, 1n] : from && factors[from] && factors[to] ? [factors[from], factors[to]] : null;
const known = (value: number | null): value is number => value !== null && Number.isFinite(value);

// Compare decimals by cross multiplication, avoiding floating-point unit conversion.
const decimalParts = (value: number): [bigint, bigint] => {
  const [digits, exponent = '0'] = String(value).split('e');
  const scale = (digits.split('.')[1]?.length ?? 0) - Number(exponent);
  const coefficient = BigInt(digits.replace('.', ''));
  return scale >= 0 ? [coefficient, 10n ** BigInt(scale)] : [coefficient * 10n ** BigInt(-scale), 1n];
};
const compareConverted = (value: number, limit: number, [numerator, denominator]: [bigint, bigint]) => {
  const [amount, amountScale] = decimalParts(value);
  const [bound, boundScale] = decimalParts(limit);
  const left = amount * numerator * boundScale;
  const right = bound * denominator * amountScale;
  return left < right ? -1 : left > right ? 1 : 0;
};

// Category, active state, owner exclusion and creation time are filtered in SQL.
// Geographic selections form a union. A selected country includes its descendants.
export function matchesDemandCriteria(criteria: DemandCriteria, request: MatchRequest): boolean {
  const cityMatch = Boolean(request.settlementCode && criteria.settlementCodes.includes(request.settlementCode))
    || criteria.cityOutsideKm != null && Boolean(request.publicPoint && criteria.settlementCodes.some(code => {
      const boundary = criteria.settlementBoundaries?.[code];
      return boundary && withinCityOrDistance(request.publicPoint!, boundary, criteria.cityOutsideKm!);
    }));
  const countries = criteria.countryCodes ?? (criteria.countryCode ? [criteria.countryCode] : []);
  const regions = criteria.regions ?? (criteria.region ? [criteria.region] : []);
  if (!(request.countryCode && countries.includes(request.countryCode))
    && !(request.region && regions.includes(request.region)) && !cityMatch) return false;
  if (criteria.radiusKm !== null) {
    if (!criteria.center || !request.publicPoint) return false;
    const distance = distanceKm(criteria.center, request.publicPoint);
    if (!Number.isFinite(distance) || distance > criteria.radiusKm) return false;
  }
  const budgetKnown = known(request.minPrice) || known(request.maxPrice);
  if (criteria.currency && budgetKnown && request.currency !== criteria.currency) return false;

  const quantityFilter = criteria.minQuantity !== null || criteria.maxQuantity !== null;
  const priceFilter = criteria.minPrice !== null || criteria.maxPrice !== null;
  const ratio: [bigint, bigint] | null = criteria.unit ? unitRatio(request.unit, criteria.unit) : [1n, 1n];
  if (criteria.unit && ratio === null) return false;
  if (quantityFilter) {
    if (!known(request.quantity) || request.quantity <= 0 || ratio === null) return false;
    if (criteria.minQuantity !== null && compareConverted(request.quantity, criteria.minQuantity, ratio) < 0) return false;
    if (criteria.maxQuantity !== null && compareConverted(request.quantity, criteria.maxQuantity, ratio) > 0) return false;
  }
  if (priceFilter && budgetKnown) {
    if (request.currency !== criteria.currency || ratio === null) return false;
    // Prices are per Request unit, so their conversion is inverse to quantity.
    if (known(request.minPrice) && request.minPrice < 0 || known(request.maxPrice) && request.maxPrice < 0
      || known(request.minPrice) && known(request.maxPrice) && request.minPrice > request.maxPrice) return false;
    const priceRatio: [bigint, bigint] = [ratio[1], ratio[0]];
    if (criteria.minPrice !== null && known(request.maxPrice) && compareConverted(request.maxPrice, criteria.minPrice, priceRatio) < 0) return false;
    if (criteria.maxPrice !== null && known(request.minPrice) && compareConverted(request.minPrice, criteria.maxPrice, priceRatio) > 0) return false;
  }
  // Both checked is unrestricted, including old Requests with unknown receipt.
  if (criteria.receiptMethods.length === 1 && !request.deliveryPreferred
    && (!request.receiptMethod || !criteria.receiptMethods.includes(request.receiptMethod))) return false;
  return true;
}
