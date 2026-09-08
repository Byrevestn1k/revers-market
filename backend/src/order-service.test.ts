import { describe, expect, it } from 'vitest'
import { canTransitionOrder, isOrderParticipant } from './order-service.js'

describe('order authorization', () => {
    it('allows only buyer or seller', () => {
        expect(isOrderParticipant('buyer', 'buyer', 'seller')).toBe(true)
        expect(isOrderParticipant('seller', 'buyer', 'seller')).toBe(true)
        expect(isOrderParticipant('other', 'buyer', 'seller')).toBe(false)
    })
})

describe('order status machine', () => {
    it.each([
        ['draft', 'active'], ['active', 'offer_received'], ['offer_received', 'accepted'],
        ['accepted', 'in_progress'], ['in_progress', 'completed'], ['offer_received', 'rejected'],
        ['active', 'cancelled'], ['active', 'expired'],
    ])('allows %s -> %s', (from, to) => expect(canTransitionOrder(from, to)).toBe(true))

    it.each([
        ['draft', 'completed'], ['completed', 'active'], ['cancelled', 'in_progress'],
        ['accepted', 'completed'], ['offer_received', 'in_progress'],
    ])('blocks %s -> %s', (from, to) => expect(canTransitionOrder(from, to)).toBe(false))
})