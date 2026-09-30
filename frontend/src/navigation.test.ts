import { describe, expect, it } from 'vitest'
import { conversationIdForPath, legacyDestination, viewForPath, viewRoutes } from './navigation'

describe('canonical navigation', () => {
    it('maps list destinations to one stable path', () => {
        expect(viewRoutes.products).toBe('/products')
        expect(viewRoutes.market).toBe('/requests')
        expect(viewRoutes.orders).toBe('/orders')
        expect(viewForPath('/my/products')).toBe('mine')
    })

    it('restores an individual conversation from its path', () => {
        expect(viewForPath('/messages/abc-123')).toBe('messages')
        expect(conversationIdForPath('/messages/abc%20123')).toBe('abc 123')
        expect(conversationIdForPath('/messages')).toBeNull()
    })

    it('normalizes legacy query links without keeping duplicate state', () => {
        expect(legacyDestination('?view=messages&conversation=chat-1')).toBe('/messages/chat-1')
        expect(legacyDestination('?view=messages&filter=buying')).toBe('/messages?filter=buying')
        expect(legacyDestination('?view=orders')).toBe('/orders')
    })
})
