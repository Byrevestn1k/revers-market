import { afterEach, describe, expect, it } from 'vitest'
import { isModerator, validateRating, validateReviewBody, blockUser } from './community-service.js'
import type { AuthUser } from './auth.js'

const user = (id: string): AuthUser => ({ id, username: `user-${id}`, countryCode: 'UA', phone: '+380501234567', email: `${id}@example.com`, emailVerified: true })

afterEach(() => {
    delete process.env.MODERATOR_USER_IDS
})

describe('review rating validation', () => {
    it('accepts integer ratings 1-5', () => {
        for (const rating of [1, 2, 3, 4, 5]) expect(validateRating(rating)).toBeNull()
    })

    it.each([[0], [6], [12], [-1], [1.5], ['4'], [null], [undefined]])('rejects rating %p', (rating) => {
        expect(validateRating(rating)).toBe('Оцінка має бути цілим числом від 1 до 5')
    })
})

describe('review body validation', () => {
    it('accepts undefined and short strings', () => {
        expect(validateReviewBody(undefined)).toBeNull()
        expect(validateReviewBody('Гарний продавець')).toBeNull()
    })

    it('rejects non-string bodies and bodies over 2000 chars', () => {
        expect(validateReviewBody(123)).toBe('Відгук надто довгий')
        expect(validateReviewBody('a'.repeat(2001))).toBe('Відгук надто довгий')
        expect(validateReviewBody('a'.repeat(2000))).toBeNull()
    })
})

describe('moderator detection', () => {
    it('recognizes ids listed in MODERATOR_USER_IDS', () => {
        process.env.MODERATOR_USER_IDS = 'mod-1, mod-2'
        expect(isModerator(user('mod-1'))).toBe(true)
        expect(isModerator(user('mod-2'))).toBe(true)
        expect(isModerator(user('regular'))).toBe(false)
    })

    it('treats everyone as non-moderator when the env var is unset', () => {
        expect(isModerator(user('mod-1'))).toBe(false)
    })
})

describe('block self-prevention', () => {
    it('refuses to block yourself before touching the database', async () => {
        const result = await blockUser(user('me'), 'me')
        expect(result.status).toBe(400)
        expect(result.body).toEqual({ error: 'CANNOT_BLOCK_SELF' })
    })
})
