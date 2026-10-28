import { describe, expect, it } from 'vitest'
import { validateProductInput } from './product-validation.js'

const validProduct = {
    categoryId: '00000000-0000-4000-8000-000000000001', title: 'Пшениця', description: 'Якісна пшениця',
    quantity: 10, unit: 'ton', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київська область',
    photos: [{ url: 'https://cdn.example.com/wheat.jpg', alt: 'Пшениця' }],
}

describe('product validation', () => {
    it('accepts a product priced in USD', () => expect(validateProductInput({ ...validProduct, price: 100, currency: 'USD' })).toEqual([]))
    it('accepts a complete product payload', () => expect(validateProductInput(validProduct)).toEqual([]))
    it('rejects uncontrolled values and unsafe photo URLs', () => {
        expect(validateProductInput({ ...validProduct, unit: 'random', deliveryMode: 'unknown', photos: [{ url: 'javascript:alert(1)' }] })).toEqual(['unit', 'deliveryMode', 'photos'])
    })
    it('supports partial updates while validating supplied fields', () => {
        expect(validateProductInput({ title: 'Оновлено' }, true)).toEqual([])
        expect(validateProductInput({ price: -1 }, true)).toEqual(['price'])
    })
    it('requires a complete, explicitly approved address before publishing it', () => {
        expect(validateProductInput({ ...validProduct, addressVisibility: 'public', address: 'Київ, Хрещатик, 1', latitude: 50.45, longitude: 30.52 })).toContain('addressVisibilityConsent')
        expect(validateProductInput({ ...validProduct, addressVisibility: 'public', addressVisibilityConsent: true, address: 'Київ, Хрещатик, 1', latitude: 50.45, longitude: 30.52 })).toEqual([])
        expect(validateProductInput({ ...validProduct, addressVisibility: 'public', addressVisibilityConsent: true })).toContain('addressVisibility')
    })
    it('requires coordinates for an own map point', () => {
        expect(validateProductInput({ ...validProduct, mapLocationMode: 'pin' })).toContain('mapLocationMode')
        expect(validateProductInput({ ...validProduct, mapLocationMode: 'pin', latitude: 50.45, longitude: 30.52 })).toEqual([])
    })
    it('allows up to eight photos and rejects nine', () => {
        const photo = { url: 'https://cdn.example.com/photo.jpg' }
        for (const count of [0, 1, 8]) expect(validateProductInput({ ...validProduct, photos: Array(count).fill(photo) })).toEqual([])
        expect(validateProductInput({ ...validProduct, photos: Array(9).fill(photo) })).toContain('photos')
        expect(validateProductInput({ photos: [{ url: '/uploads/products/existing/0.jpg' }] }, true)).toEqual([])
    })
    it('accepts a browser image data URL and rejects oversized or non-image data', () => {
        expect(validateProductInput({ ...validProduct, photos: [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }] })).toEqual([])
        expect(validateProductInput({ ...validProduct, photos: [{ dataUrl: 'data:text/plain;base64,aGVsbG8=' }] })).toEqual(['photos'])
    })
})
