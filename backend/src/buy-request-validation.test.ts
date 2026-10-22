import { describe, expect, it } from 'vitest'
import { validateBuyRequestInput, validateOfferInput } from './buy-request-validation.js'

const request = { categoryId: '00000000-0000-4000-8000-000000000001', title: 'Потрібна пшениця', description: 'Для господарства', quantity: 10, unit: 'ton', currency: 'UAH', minPrice: 200, maxPrice: 250, delivery: 'yes', deliveryRequired: true, preferredDelivery: 'До складу', geoArea: 'Київська область', address: 'с. Приклад', deadline: '2030-01-01T00:00:00.000Z' }
const offer = { quantity: 5, unit: 'ton', price: 220, currency: 'UAH', delivery: 'Доставка продавцем', note: 'Свіжий урожай' }

describe('buy request and offer validation', () => {
    it('accepts complete request and offer', () => { expect(validateBuyRequestInput(request)).toEqual([]); expect(validateOfferInput(offer)).toEqual([]) })
    it('accepts USD budgets and USD offers without changing the amount', () => {
        expect(validateBuyRequestInput({ ...request, currency: 'USD', minPrice: 100, maxPrice: 100 })).toEqual([])
        expect(validateOfferInput({ ...offer, currency: 'USD', price: 100 })).toEqual([])
    })
    it('requires a coherent price range', () => expect(validateBuyRequestInput({ ...request, minPrice: 300, maxPrice: 250 })).toContain('priceRange'))
    it('accepts exact price and normalized delivery modes', () => expect(validateBuyRequestInput({ ...request, exactPrice: 220, minPrice: undefined, maxPrice: undefined, delivery: 'preferred' })).toEqual([]))
    it('rejects unsafe additional offer photos', () => expect(validateOfferInput({ ...offer, additionalPhotoUrl: 'javascript:alert(1)' })).toContain('additionalPhotoUrl'))
    it('validates seller offer details and uploaded photos in all creation modes', () => {
        const photo = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==' }
        for (const creationMode of ['product', 'manual', 'request_terms']) expect(validateOfferInput({ ...offer, creationMode, title: 'Товар продавця', description: 'Опис', characteristics: 'Сорт А', photos: [photo] })).toEqual([])
        expect(validateOfferInput({ ...offer, photos: Array(9).fill(photo) })).toContain('photos')
        expect(validateOfferInput({ ...offer, photos: [{ url: '/uploads/offers/other/0.png' }] })).toContain('photos')
        expect(validateOfferInput({ ...offer, title: 'x' })).toContain('title')
        expect(validateOfferInput({ ...offer, creationMode: 'unknown' })).toContain('creationMode')
        const id = '00000000-0000-4000-8000-000000000001'
        expect(validateOfferInput({ ...offer, photos: [{ url: `/uploads/offers/${id}/copied-0/0.png` }] })).toEqual([])
        expect(validateOfferInput({ ...offer, photos: [{ url: `/uploads/offers/${id}/${id}/0.png` }] })).toEqual([])
    })
    it('validates supplied fields for partial request updates', () => expect(validateBuyRequestInput({ title: 'Оновлено' }, true)).toEqual([]))
    it('allows unpriced requests but keeps quantity required', () => {
        const { minPrice, maxPrice, quantity, ...withoutQuantity } = request
        expect(validateBuyRequestInput({ ...withoutQuantity, quantity })).toEqual([])
        expect(validateBuyRequestInput(withoutQuantity)).toContain('quantity')
    })
    it('accepts up to eight uploaded photos and rejects invalid files or counts', () => {
        const photo = { dataUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', alt: 'Фото' }
        expect(validateBuyRequestInput({ ...request, photos: Array(8).fill(photo) })).toEqual([])
        expect(validateBuyRequestInput({ ...request, photos: Array(9).fill(photo) })).toContain('photos')
        expect(validateBuyRequestInput({ ...request, photos: [{ dataUrl: 'data:text/html;base64,aGVsbG8=' }] })).toContain('photos')
        expect(validateBuyRequestInput({ ...request, photos: [{ url: 'https://example.com/image.png' }] })).toContain('photos')
    })
    it('requires explicit supported receipt methods to agree with legacy fields', () => {
        expect(validateBuyRequestInput({ receiptMethod: 'SELF_PICKUP' }, true)).toEqual([])
        expect(validateBuyRequestInput({ receiptMethod: 'SELLER_DELIVERY' }, true)).toEqual([])
        expect(validateBuyRequestInput({ receiptMethod: 'CARRIER' }, true)).toContain('receiptMethod')
        expect(validateBuyRequestInput({ receiptMethod: 'SELF_PICKUP', deliveryRequired: true }, true)).toContain('receiptMethod')
        expect(validateBuyRequestInput({ receiptMethod: 'SELLER_DELIVERY', delivery: 'no' }, true)).toContain('receiptMethod')
    })
    it('requires consent and a complete address before publishing a request address', () => {
        expect(validateBuyRequestInput({ ...request, addressVisibility: 'public', latitude: 50.45, longitude: 30.52 })).toContain('addressVisibilityConsent')
        expect(validateBuyRequestInput({ ...request, addressVisibility: 'public', addressVisibilityConsent: true, latitude: 50.45, longitude: 30.52 })).toEqual([])
    })
    it('requires an address and coordinates for a request-specific address point', () => {
        expect(validateBuyRequestInput({ ...request, mapLocationMode: 'address', latitude: 50.45, longitude: 30.52 })).toEqual([])
        expect(validateBuyRequestInput({ ...request, mapLocationMode: 'address' })).toContain('mapLocationMode')
    })
})
