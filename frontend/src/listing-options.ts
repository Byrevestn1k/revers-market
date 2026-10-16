export const LISTING_UNITS = [{ value: 'piece', label: 'шт.' }, { value: 'kg', label: 'кг' }, { value: 'ton', label: 'тонна' }, { value: 'litre', label: 'літр' }, { value: 'box', label: 'ящик' }]
export const CURRENCIES = ['UAH', 'EUR', 'PLN']
export const DELIVERY_LABELS: Record<string, string> = { pickup: 'Самовивіз', seller_delivery: 'Доставка продавця', carrier: 'Перевізник', flexible: 'Можна домовитися' }
export const LISTING_STATUS: Record<string, string> = { draft: 'Чернетка', active: 'Активний', paused: 'Призупинений', sold: 'Проданий', expired: 'Завершений' }
export const unitLabel = (unit?: string) => LISTING_UNITS.find((item) => item.value === unit)?.label ?? unit ?? ''
export const listingPrice = (amount: number, currency: string) => new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(amount) + ' ' + currency
export const requestBudget = (price: { min: number | null; max: number | null; currency: string }) => {
    if (price.min === null && price.max === null) return 'Ціна не вказана'
    if (price.min !== null && price.max !== null) return price.min === price.max ? listingPrice(price.min, price.currency) : `${listingPrice(price.min, price.currency)}–${listingPrice(price.max, price.currency)}`
    return price.min !== null ? `від ${listingPrice(price.min, price.currency)}` : `до ${listingPrice(price.max!, price.currency)}`
}
