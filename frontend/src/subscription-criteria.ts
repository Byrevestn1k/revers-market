import { COUNTRIES } from './countries';
import type { Settlement } from './settlement-model';

export const receiptLabels = {
  SELF_PICKUP: 'Самовивіз — покупець забирає товар у продавця',
  SELLER_DELIVERY: 'Доставка продавцем — продавець привозить товар у місце покупця',
};
export type ReceiptMethod = keyof typeof receiptLabels;
export type SubscriptionCriteria = {
  countryCode: string | null; region: string | null; settlementCodes: string[]; settlements: Settlement[];
  center: { latitude: number; longitude: number } | null; radiusKm: number | null;
  minQuantity: number | null; maxQuantity: number | null; unit: string | null;
  minPrice: number | null; maxPrice: number | null; currency: string | null; receiptMethods: ReceiptMethod[];
};
export type CriteriaDraft = {
  countryCode: string; region: string; settlements: Settlement[]; radiusEnabled: boolean; radiusKm: string;
  centerLatitude: string; centerLongitude: string; minQuantity: string; maxQuantity: string; unit: string;
  minPrice: string; maxPrice: string; currency: string; receiptMethods: ReceiptMethod[];
};
export const emptyCriteria = (): CriteriaDraft => ({ countryCode: 'UA', region: '', settlements: [], radiusEnabled: false, radiusKm: '25',
  centerLatitude: '', centerLongitude: '', minQuantity: '', maxQuantity: '', unit: '', minPrice: '', maxPrice: '', currency: '', receiptMethods: [] });
export const criteriaDraft = (item: Partial<SubscriptionCriteria>): CriteriaDraft => ({
  ...emptyCriteria(), countryCode: item.countryCode ?? 'UA', region: item.region ?? '', settlements: item.settlements ?? [],
  radiusEnabled: item.radiusKm != null, radiusKm: String(item.radiusKm ?? 25),
  centerLatitude: item.center ? String(item.center.latitude) : '', centerLongitude: item.center ? String(item.center.longitude) : '',
  minQuantity: item.minQuantity == null ? '' : String(item.minQuantity), maxQuantity: item.maxQuantity == null ? '' : String(item.maxQuantity), unit: item.unit ?? '',
  minPrice: item.minPrice == null ? '' : String(item.minPrice), maxPrice: item.maxPrice == null ? '' : String(item.maxPrice), currency: item.currency ?? '', receiptMethods: item.receiptMethods ?? [],
});
export const criteriaPayload = (draft: CriteriaDraft) => ({
  countryCode: draft.countryCode || null, region: draft.region || null, settlementCodes: draft.settlements.map(item => item.code),
  center: draft.radiusEnabled && draft.centerLatitude !== '' && draft.centerLongitude !== '' ? { latitude: Number(draft.centerLatitude), longitude: Number(draft.centerLongitude) } : null,
  radiusKm: draft.radiusEnabled ? Number(draft.radiusKm) : null,
  minQuantity: draft.minQuantity === '' ? null : Number(draft.minQuantity), maxQuantity: draft.maxQuantity === '' ? null : Number(draft.maxQuantity), unit: draft.unit || null,
  minPrice: draft.minPrice === '' ? null : Number(draft.minPrice), maxPrice: draft.maxPrice === '' ? null : Number(draft.maxPrice), currency: draft.currency || null, receiptMethods: draft.receiptMethods,
});
export const countryName = (code: string | null | undefined) => COUNTRIES.find(item => item.code === code)?.name ?? code ?? 'Країна не обмежена';
export const receiptLabel = (method?: ReceiptMethod | null) => method ? receiptLabels[method] : 'Спосіб отримання не вказано';
