import { cityBoundary, settlementAdministrativeBoundary, withinCityOrDistance } from './city-boundaries.js';
import type { MapPoint } from './map-service.js';
import { getSettlement, listSettlementRegions, normalizeSettlementName, resolvePublicSettlement } from './settlements.js';
import type { DeliveryOption, DeliveryPlace } from './delivery-compatibility.js';

const regions = new Set(listSettlementRegions().regions);
const validPoint = (point: MapPoint | null): point is MapPoint => Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude)
  && Math.abs(point.latitude) <= 90 && Math.abs(point.longitude) <= 180);

// Public points are rounded to 0.01 degrees; allow that rounding at a verified boundary.
export async function verifiedSettlementPoint(code: string | null, point: MapPoint | null, roundingKm = 0): Promise<boolean> {
  const settlement = getSettlement(code);
  if (!settlement || !validPoint(point)) return false;
  const boundary = await settlementAdministrativeBoundary(settlement);
  return Boolean(boundary && boundary.source?.settlementCode === settlement.code && withinCityOrDistance(point, boundary, roundingKm));
}

async function reverseAddress(point: MapPoint): Promise<{ countryCode: string; region: string | null } | null> {
  try {
    const params = new URLSearchParams({ lat: String(point.latitude), lon: String(point.longitude), format: 'jsonv2', zoom: '5', addressdetails: '1', 'accept-language': 'uk' });
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?${params}`, {
      headers: { 'User-Agent': process.env.OSM_USER_AGENT || 'NavpakyMarketplace/1.0 (delivery geography)' },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return null;
    const result = await response.json() as { address?: { country_code?: string; state?: string } };
    if (result.address?.country_code !== 'ua') return null;
    return { countryCode: 'UA', region: [...regions].find(region => normalizeSettlementName(region) === normalizeSettlementName(result.address?.state ?? '')) ?? null };
  } catch { return null; }
}

export async function verifiedInputPoint(input: { settlementCode?: unknown; label?: unknown; countryCode?: unknown; latitude?: unknown; longitude?: unknown }): Promise<boolean> {
  if (input.latitude == null && input.longitude == null) return true;
  if (typeof input.latitude !== 'number' || typeof input.longitude !== 'number') return false;
  const point = { latitude: input.latitude, longitude: input.longitude };
  if (!validPoint(point)) return false;
  const settlement = getSettlement(input.settlementCode) ?? (input.settlementCode == null ? resolvePublicSettlement(input.label, input.countryCode) : null);
  if (settlement) return verifiedSettlementPoint(settlement.code, point);
  if (input.countryCode != null && input.countryCode !== 'UA') return true;
  if (typeof input.label !== 'string') return false;
  if (regions.has(input.label) && input.label !== 'Київ' && input.label !== 'Севастополь') return (await reverseAddress(point))?.region === input.label;
  const boundary = await cityBoundary(input.label, point);
  return Boolean(boundary && withinCityOrDistance(point, boundary, 0))
    || regions.has(input.label) && (await reverseAddress(point))?.region === input.label;
}

export async function verifiedSubscriptionCenter(center: MapPoint | null, settlementCodes: string[], selectedRegions: string[], countryCodes: string[]): Promise<boolean> {
  if (!center) return true;
  if (!validPoint(center)) return false;
  for (const code of settlementCodes) if (await verifiedSettlementPoint(code, center)) return true;
  const address = await reverseAddress(center);
  return Boolean(address && (selectedRegions.includes(address.region ?? '') || countryCodes.includes('UA')));
}

export async function verifiedDeliveryOptions(options: DeliveryOption[] | null | undefined): Promise<boolean> {
  if (!options) return true;
  for (const option of options) {
    if (option.place?.publicPoint && !await verifiedSettlementPoint(option.place.settlementCode, option.place.publicPoint, 1.5)) return false;
  }
  return true;
}

export async function verifiedDeliveryPlace(place: DeliveryPlace): Promise<DeliveryPlace> {
  return { ...place, verifiedPoint: await verifiedSettlementPoint(place.settlementCode, place.publicPoint, 1.5) };
}

export async function verifiedOptionsForMatching(options: DeliveryOption[] | null | undefined): Promise<DeliveryOption[] | null> {
  if (!options) return null;
  return Promise.all(options.map(async option => option.place ? { ...option, place: await verifiedDeliveryPlace(option.place) } : option));
}
