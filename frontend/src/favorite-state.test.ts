import { describe, expect, it } from 'vitest'
import { favoriteKey, favoriteKeys, uniqueFavorites, withFavorite } from './favorite-state'

describe('favorite cards state', () => {
    it('keeps one synchronized key for every card type', () => {
        const loaded = favoriteKeys([
            { targetType: 'product', targetId: 'p1' },
            { targetType: 'buy_request', targetId: 'r1' },
            { targetType: 'profile', targetId: 'u1' },
        ])
        expect([...loaded]).toEqual(['product:p1', 'buy_request:r1', 'profile:u1'])
        expect(withFavorite(loaded, 'product', 'p1', false).has(favoriteKey('product', 'p1'))).toBe(false)
        expect(withFavorite(loaded, 'product', 'p2', true).has(favoriteKey('product', 'p2'))).toBe(true)
    })

    it('does not render duplicate favorite cards', () => {
        const items = uniqueFavorites([
            { targetType: 'product' as const, targetId: 'p1', title: 'first' },
            { targetType: 'product' as const, targetId: 'p1', title: 'duplicate' },
            { targetType: 'profile' as const, targetId: 'p1', title: 'different type' },
        ])
        expect(items.map(item => item.title)).toEqual(['first', 'different type'])
    })
})
