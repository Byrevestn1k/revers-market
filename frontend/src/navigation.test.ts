import { describe, expect, it } from 'vitest'
import { conversationIdForPath, legacyDestination, productEditIdForPath, productEditPath, viewForPath, viewRoutes } from './navigation'

describe('canonical navigation', () => {
    it('maps list destinations to one stable path', () => {
        expect(viewRoutes.products).toBe('/products')
        expect(viewRoutes.market).toBe('/requests')
        expect(viewRoutes.orders).toBe('/orders')
        expect(viewForPath('/my/products')).toBe('mine')
        expect(viewRoutes.favorites).toBe('/favorites')
        expect(viewForPath('/cabinet')).toBe('cabinet')
    })

    it('restores an individual conversation from its path', () => {
        expect(viewForPath('/messages/abc-123')).toBe('messages')
        expect(conversationIdForPath('/messages/abc%20123')).toBe('abc 123')
        expect(conversationIdForPath('/messages')).toBeNull()
    })

    it('uses one reload-safe path for the existing product editor', () => {
        expect(productEditPath('product 123')).toBe('/my/products/product%20123/edit')
        expect(viewForPath('/my/products/product-123/edit')).toBe('create')
        expect(productEditIdForPath('/my/products/product%20123/edit')).toBe('product 123')
        expect(productEditIdForPath('/my/products/new')).toBeNull()
    })

    it('normalizes legacy query links without keeping duplicate state', () => {
        expect(legacyDestination('?view=messages&conversation=chat-1')).toBe('/messages/chat-1')
        expect(legacyDestination('?view=messages&filter=buying')).toBe('/messages?filter=buying')
        expect(legacyDestination('?view=orders')).toBe('/orders')
    })
})
