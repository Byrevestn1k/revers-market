import { describe, expect, it } from 'vitest'
import { validateProductInput } from './product-validation.js'

const validProduct = {
    categoryId: '00000000-0000-4000-8000-000000000001', title: 'Пшениця', description: 'Якісна пшениця',
    quantity: 10, unit: 'ton', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київська область',
    photos: [{ url: 'https://cdn.example.com/wheat.jpg', alt: 'Пшениця' }],
}

describe('product validation', () => {
    it('accepts a complete product payload', () => expect(validateProductInput(validProduct)).toEqual([]))
    it('rejects uncontrolled values and unsafe photo URLs', () => {
        expect(validateProductInput({ ...validProduct, unit: 'random', deliveryMode: 'unknown', photos: [{ url: 'javascript:alert(1)' }] })).toEqual(['unit', 'deliveryMode', 'photos'])
    })
    it('supports partial updates while validating supplied fields', () => {
        expect(validateProductInput({ title: 'Оновлено' }, true)).toEqual([])
        expect(validateProductInput({ price: -1 }, true)).toEqual(['price'])
    })
    it('accepts a browser image data URL and rejects oversized or non-image data', () => {
        expect(validateProductInput({ ...validProduct, photos: [{ dataUrl: 'data:image/png;base64,aGVsbG8=' }] })).toEqual([])
        expect(validateProductInput({ ...validProduct, photos: [{ dataUrl: 'data:text/plain;base64,aGVsbG8=' }] })).toEqual(['photos'])
    })
})
