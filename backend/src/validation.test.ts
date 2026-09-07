import { describe, expect, it } from 'vitest'
import { validateRegistration } from './validation.js'

describe('registration validation', () => {
    it('accepts a valid registration payload', () => {
        expect(validateRegistration({
            username: 'farmer_01', countryCode: 'UA', phone: '+380501234567',
            password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1',
        })).toEqual([])
    })

    it('rejects weak passwords and mismatched confirmation', () => {
        const errors = validateRegistration({ username: 'ab', countryCode: 'U', phone: 'abc', password: 'short', passwordConfirmation: 'other' })
        expect(errors).toHaveLength(5)
        expect(errors.join(' ')).toContain('Пароли не совпадают')
    })
})
