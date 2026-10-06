import { describe, expect, it } from 'vitest'
import { activityGroup, activityGroups, activityItems, canEditSellerOffer, canWithdrawSellerOffer } from './activity'

describe('activity organisation', () => {
    it('places each product and historical request in exactly one visible group', () => {
        const products = ['draft', 'active', 'paused', 'sold', 'expired'].map((status, index) => ({ id: String(index), status }))
        expect(activityGroups.product.map(group => activityItems('product', products, group.id).length)).toEqual([1, 3, 1, 5])
        const requests = ['open', 'partially_selected', 'partially_completed', 'partially_fulfilled', 'completed', 'fulfilled', 'cancelled', 'expired'].map((status, index) => ({ id: String(index), status }))
        expect(activityGroups.request.map(group => activityItems('request', requests, group.id).length)).toEqual([4, 2, 1, 1, 8])
    })

    it('keeps seller offers with the request and distinguishes pending action from accepted history', () => {
        const offers = [
            { id: 'a', status: 'submitted', requestStatus: 'open', acceptedQuantity: 0, pendingNegotiation: true },
            { id: 'b', status: 'accepted', requestStatus: 'partially_selected', acceptedQuantity: 5, waitingConfirmation: true },
            { id: 'c', status: 'partially_accepted', requestStatus: 'completed', acceptedQuantity: 5 },
            { id: 'd', status: 'rejected', requestStatus: 'open', acceptedQuantity: 0 },
            { id: 'e', status: 'withdrawn', requestStatus: 'cancelled', acceptedQuantity: 0 },
            { id: 'f', status: 'expired', requestStatus: 'expired', acceptedQuantity: 0 },
            { id: 'g', status: 'submitted', requestStatus: 'open', acceptedQuantity: 0 },
        ]
        expect(activityGroups.offer.map(group => activityItems('offer', offers, group.id).length)).toEqual([2, 1, 1, 2, 1, 7])
        expect(new Set(activityGroups.offer.filter(group => group.id !== 'all').flatMap(group => activityItems('offer', offers, group.id).map(item => item.id))).size).toBe(offers.length)
        expect(activityGroup('offer', { id: 'old', status: 'withdrawn', requestStatus: 'open', pendingNegotiation: true })).toBe('closed')
    })

    it('keeps submitted offers on terminal requests historical and applies the same action rule', () => {
        const offers = ['open', 'completed', 'fulfilled', 'cancelled', 'expired'].map((requestStatus, index) => ({ id: String(index), status: 'submitted', requestStatus, acceptedQuantity: 0 }))
        expect(activityGroups.offer.map(group => activityItems('offer', offers, group.id).length)).toEqual([0, 1, 0, 0, 4, 5])
        expect(canEditSellerOffer(offers[0])).toBe(true)
        expect(canWithdrawSellerOffer(offers[0])).toBe(true)
        for (const offer of offers.slice(1)) {
            expect(activityGroup('offer', offer)).toBe('inactive')
            expect(canEditSellerOffer(offer)).toBe(false)
            expect(canWithdrawSellerOffer(offer)).toBe(false)
        }
        expect(activityGroup('offer', { id: 'selected', status: 'accepted', requestStatus: 'cancelled', acceptedQuantity: 5, waitingConfirmation: true })).toBe('attention')
        expect(activityGroup('offer', { id: 'selected-done', status: 'accepted', requestStatus: 'completed', acceptedQuantity: 5 })).toBe('completed')
        expect(canEditSellerOffer({ id: 'rejected', status: 'rejected', requestStatus: 'open', acceptedQuantity: 0 })).toBe(false)
        expect(canEditSellerOffer({ id: 'withdrawn', status: 'withdrawn', requestStatus: 'open', acceptedQuantity: 0 })).toBe(false)
    })

    it('classifies the same deal by the hybrid viewer role without changing its status', () => {
        const selected = { id: '1', status: 'selected', buyer: { id: 'buyer' }, seller: { id: 'seller' } }
        expect(activityGroup('deal', selected, 'seller')).toBe('attention')
        expect(activityGroup('deal', selected, 'buyer')).toBe('active')
        const sellerMarked = { ...selected, status: 'seller_marked_completed' }
        expect(activityGroup('deal', sellerMarked, 'buyer')).toBe('attention')
        expect(activityGroup('deal', sellerMarked, 'seller')).toBe('active')
        const buyerMarked = { ...selected, status: 'buyer_marked_completed' }
        expect(activityGroup('deal', buyerMarked, 'seller')).toBe('attention')
        expect(activityGroup('deal', buyerMarked, 'buyer')).toBe('active')
        expect(activityGroup('deal', { ...selected, status: 'completed' }, 'buyer')).toBe('completed')
        expect(activityGroup('deal', { ...selected, status: 'cancelled' }, 'seller')).toBe('closed')
        expect(activityGroup('deal', { ...selected, status: 'disputed', dispute: { status: 'open' } }, 'buyer')).toBe('attention')
        for (const status of ['draft', 'active', 'offer_received', 'accepted', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed']) {
            expect(activityGroup('deal', { ...selected, status }, 'unrelated-viewer')).toBe('active')
        }
        for (const status of ['failed', 'cancelled', 'rejected', 'expired']) {
            expect(activityGroup('deal', { ...selected, status }, 'buyer')).toBe('closed')
        }
    })

    it('sorts newest first and breaks ties by id', () => {
        const items = [
            { id: 'a', status: 'active', updatedAt: '2026-01-01T00:00:00Z' },
            { id: 'c', status: 'active', updatedAt: '2026-01-02T00:00:00Z' },
            { id: 'b', status: 'active', updatedAt: '2026-01-02T00:00:00Z' },
        ]
        expect(activityItems('product', items, 'active').map(item => item.id)).toEqual(['c', 'b', 'a'])
    })
})
