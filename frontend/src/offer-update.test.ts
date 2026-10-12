import { describe, expect, it } from 'vitest'
import { buildOfferUpdatePayload } from './offer-update'

const offer = { existingProduct: { id: '00000000-0000-4000-8000-000000000001' }, quantity: 10, price: { amount: 100 }, delivery: 'Самовивіз', note: 'Без змін', additionalPhotoUrl: null, validUntil: null, termsSnapshot: { availableAt: '' }, deliverySnapshot: { price: 0 } }

describe('offer update payload', () => {
    it('omits an unchanged product link while preserving a note-only edit', () => {
        expect(buildOfferUpdatePayload(offer, { productId: offer.existingProduct.id, quantity: '10', price: '100', delivery: 'Самовивіз', deliveryPrice: '0', availableAt: '', note: 'Новий коментар', additionalPhotoUrl: '', validUntil: '' })).toEqual({ note: 'Новий коментар' })
    })

    it('sends a productId only when the seller selects a different product', () => {
        expect(buildOfferUpdatePayload(offer, { productId: '00000000-0000-4000-8000-000000000002', quantity: '10', price: '100', delivery: 'Самовивіз', deliveryPrice: '0', availableAt: '', note: 'Без змін', additionalPhotoUrl: '', validUntil: '' })).toEqual({ productId: '00000000-0000-4000-8000-000000000002' })
    })
})
