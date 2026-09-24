import { describe, expect, it } from 'vitest'
import { toPrivateProfile, toPublicProfile } from './profiles.js'

const row = {
    id: 'user-id', username: 'farmer', email: 'farmer@example.com', email_verified: true, country_code: 'UA', phone: '+380501234567',
    avatar_url: 'https://example.com/avatar.png', nickname: 'Фермер', bio: 'Овощи', recovery_email: 'recovery@example.com',
    location_display: 'Киевская область', exact_address: 'Точный адрес 1', phone_visibility: 'private' as const,
    phone_disclosure_consent: false, listings_count: 4, completed_deals_count: 2, response_rate: '87.50',
    rating_sum: '9.00', rating_count: 2, created_at: new Date('2026-01-01T00:00:00.000Z'), last_seen_at: null,
}

describe('profile DTO privacy', () => {
    it('only publishes the profile address in address mode, not pin mode', () => {
        const point = { public_latitude: '50.625951', public_longitude: '26.270642' }
        const pin = toPublicProfile({ ...row, ...point, map_location_mode: 'pin' })
        expect(pin).not.toHaveProperty('exactAddress')
        expect(pin.mapLocation).toEqual({ mode: 'pin', latitude: 50.625951, longitude: 26.270642 })
        expect(toPublicProfile({ ...row, ...point, map_location_mode: 'address' }).exactAddress).toBe(row.exact_address)
        expect(toPublicProfile({ ...row, map_location_mode: 'approximate' })).not.toHaveProperty('mapLocation')
    })
    it('omits exact address, recovery email, and private phone from public DTO', () => {
        const profile = toPublicProfile(row)
        expect(profile).not.toHaveProperty('exactAddress')
        expect(profile).not.toHaveProperty('recoveryEmail')
        expect(profile.phone).toBeNull()
        expect(profile.location).toBe('Киевская область')
    })

    it('calculates rating summary from immutable aggregate fields', () => {
        expect(toPublicProfile(row).ratingSummary).toEqual({ average: 4.5, count: 2 })
        expect(toPrivateProfile(row).privacy).toEqual({ phoneVisibility: 'private', phoneDisclosureConsent: false })
    })

    it('never exposes a phone publicly without explicit consent', () => {
        expect(toPublicProfile({ ...row, phone_visibility: 'public', phone_disclosure_consent: false }).phone).toBeNull()
        expect(toPublicProfile({ ...row, phone_visibility: 'public', phone_disclosure_consent: true }).phone).toBe(row.phone)
    })
})
