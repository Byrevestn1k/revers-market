import { COUNTRIES } from './countries';
import type { Settlement } from './settlement-model';

export const receiptLabels = {
  SELF_PICKUP: 'Самовивіз — покупець забирає товар у продавця',
  SELLER_DELIVERY: 'Доставка продавцем — продавець привозить товар у місце покупця',
};
export type ReceiptMethod = keyof typeof receiptLabels;
export type SubscriptionCriteria = {
  countryCode: string | null; region: string | null; countryCodes: string[]; regions: string[]; settlementCodes: string[]; settlements: Settlement[];
  center: { latitude: number; longitude: number } | null; radiusKm: number | null;
  cityOutsideKm: number | null;
  minQuantity: number | null; maxQuantity: number | null; unit: string | null;
  minPrice: number | null; maxPrice: number | null; currency: string | null; receiptMethods: ReceiptMethod[];
};
export type CriteriaDraft = {
  countryCodes: string[]; regions: string[]; settlements: Settlement[]; suburbsEnabled: boolean; cityOutsideKm: string;
  minQuantity: string; maxQuantity: string; unit: string;
  minPrice: string; maxPrice: string; currency: string; receiptMethods: ReceiptMethod[];
};
export const emptyCriteria = (): CriteriaDraft => ({ countryCodes: [], regions: [], settlements: [], suburbsEnabled: false, cityOutsideKm: '10',
  minQuantity: '', maxQuantity: '', unit: '', minPrice: '', maxPrice: '', currency: '', receiptMethods: ['SELF_PICKUP', 'SELLER_DELIVERY'] });
export const criteriaDraft = (item: Partial<SubscriptionCriteria>): CriteriaDraft => ({
  ...emptyCriteria(), countryCodes: item.countryCodes ?? (item.countryCode ? [item.countryCode] : []), regions: item.regions ?? (item.region ? [item.region] : []), settlements: item.settlements ?? [],
  suburbsEnabled: item.cityOutsideKm != null, cityOutsideKm: String(Math.min(item.cityOutsideKm ?? 10, 20)),
  minQuantity: item.minQuantity == null ? '' : String(item.minQuantity), maxQuantity: item.maxQuantity == null ? '' : String(item.maxQuantity), unit: item.unit ?? '',
  minPrice: item.minPrice == null ? '' : String(item.minPrice), maxPrice: item.maxPrice == null ? '' : String(item.maxPrice), currency: item.currency ?? '', receiptMethods: item.receiptMethods?.length ? item.receiptMethods : ['SELF_PICKUP', 'SELLER_DELIVERY'],
});
export const criteriaPayload = (draft: CriteriaDraft) => ({
  countryCodes: draft.countryCodes, regions: draft.countryCodes.includes('UA') ? [] : draft.regions,
  settlementCodes: draft.countryCodes.includes('UA') ? [] : draft.settlements.filter(city => draft.suburbsEnabled || !draft.regions.includes(city.region)).map(item => item.code),
  center: null, radiusKm: null,
  cityOutsideKm: !draft.countryCodes.includes('UA') && draft.suburbsEnabled && draft.settlements.length ? Number(draft.cityOutsideKm) : null,
  minQuantity: draft.minQuantity === '' ? null : Number(draft.minQuantity), maxQuantity: draft.maxQuantity === '' ? null : Number(draft.maxQuantity), unit: draft.unit || null,
  minPrice: draft.minPrice === '' ? null : Number(draft.minPrice), maxPrice: draft.maxPrice === '' ? null : Number(draft.maxPrice), currency: draft.currency || null, receiptMethods: draft.receiptMethods,
});
export const countryName = (code: string | null | undefined) => COUNTRIES.find(item => item.code === code)?.name ?? code ?? 'Країна не обмежена';
export const receiptLabel = (method?: ReceiptMethod | null) => method ? receiptLabels[method] : 'Спосіб отримання не вказано';
