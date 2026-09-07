import { describe, expect, it } from 'vitest'
import { validateBuyRequestInput, validateOfferInput } from './buy-request-validation.js'

const request = { categoryId: '00000000-0000-4000-8000-000000000001', title: 'Потрібна пшениця', description: 'Для господарства', quantity: 10, unit: 'ton', currency: 'UAH', minPrice: 200, maxPrice: 250, delivery: 'yes', deliveryRequired: true, preferredDelivery: 'До складу', geoArea: 'Київська область', address: 'с. Приклад', deadline: '2030-01-01T00:00:00.000Z' }
const offer = { quantity: 5, unit: 'ton', price: 220, currency: 'UAH', delivery: 'Доставка продавцем', note: 'Свіжий урожай' }

describe('buy request and offer validation', () => {
    it('accepts complete request and offer', () => { expect(validateBuyRequestInput(request)).toEqual([]); expect(validateOfferInput(offer)).toEqual([]) })
    it('requires a coherent price range', () => expect(validateBuyRequestInput({ ...request, minPrice: 300, maxPrice: 250 })).toContain('priceRange'))
    it('accepts exact price and normalized delivery modes', () => expect(validateBuyRequestInput({ ...request, exactPrice: 220, minPrice: undefined, maxPrice: undefined, delivery: 'preferred' })).toEqual([]))
    it('rejects unsafe additional offer photos', () => expect(validateOfferInput({ ...offer, additionalPhotoUrl: 'javascript:alert(1)' })).toContain('additionalPhotoUrl'))
    it('validates supplied fields for partial request updates', () => expect(validateBuyRequestInput({ title: 'Оновлено' }, true)).toEqual([]))
})