export const LISTING_UNITS = [{ value: 'piece', label: 'шт.' }, { value: 'kg', label: 'кг' }, { value: 'ton', label: 'тонна' }, { value: 'litre', label: 'літр' }, { value: 'box', label: 'ящик' }]
export const CURRENCIES = ['UAH', 'EUR', 'PLN']
export const DELIVERY_LABELS: Record<string, string> = { pickup: 'Самовивіз', seller_delivery: 'Доставка продавця', carrier: 'Перевізник' }
export const LISTING_STATUS: Record<string, string> = { draft: 'Чернетка', active: 'Активний', paused: 'Призупинений', sold: 'Проданий', expired: 'Завершений' }
export const unitLabel = (unit?: string) => LISTING_UNITS.find((item) => item.value === unit)?.label ?? unit ?? ''
export const listingPrice = (amount: number, currency: string) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(amount) + ' ' + currency
