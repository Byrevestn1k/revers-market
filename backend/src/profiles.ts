import type { Request } from 'express'
import { pool } from './db/client.js'
import type { AuthUser } from './auth.js'

type ProfileRow = {
    id: string
    username: string
    country_code: string
    phone: string
    avatar_url: string | null
    nickname: string | null
    bio: string | null
    recovery_email: string | null
    location_display: string | null
    exact_address: string | null
    phone_visibility: 'private' | 'authenticated' | 'public'
    phone_disclosure_consent: boolean
    listings_count: number
    completed_deals_count: number
    response_rate: string | number | null
    rating_sum: string | number
    rating_count: number
    created_at: Date
}

export type PublicProfileDto = {
    id: string
    username: string
    nickname: string | null
    avatarUrl: string | null
    bio: string | null
    countryCode: string
    location: string | null
    phone: string | null
    statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }
    ratingSummary: { average: number | null; count: number }
    createdAt: string
}

export type PrivateProfileDto = PublicProfileDto & {
    phone: string
    recoveryEmail: string | null
    exactAddress: string | null
    privacy: { phoneVisibility: ProfileRow['phone_visibility']; phoneDisclosureConsent: boolean }
}

const profileSelect = `
    SELECT id, username, country_code, phone, avatar_url, nickname, bio, recovery_email,
           location_display, exact_address, phone_visibility, phone_disclosure_consent,
           listings_count, completed_deals_count, response_rate, rating_sum, rating_count, created_at
    FROM users`

const toNumberOrNull = (value: string | number | null) => value === null ? null : Number(value)
const ratingSummary = (row: ProfileRow) => ({
    average: row.rating_count > 0 ? Math.round((Number(row.rating_sum) / row.rating_count) * 100) / 100 : null,
    count: row.rating_count,
})

export const toPublicProfile = (row: ProfileRow): PublicProfileDto => ({
    id: row.id,
    username: row.username,
    nickname: row.nickname,
    avatarUrl: row.avatar_url,
    bio: row.bio,
    countryCode: row.country_code,
    location: row.location_display,
    phone: row.phone_visibility === 'public' && row.phone_disclosure_consent ? row.phone : null,
    statistics: { listingsCount: row.listings_count, completedDealsCount: row.completed_deals_count, responseRate: toNumberOrNull(row.response_rate) },
    ratingSummary: ratingSummary(row),
    createdAt: row.created_at.toISOString(),
})

export const toPrivateProfile = (row: ProfileRow): PrivateProfileDto => ({
    ...toPublicProfile(row),
    phone: row.phone,
    recoveryEmail: row.recovery_email,
    exactAddress: row.exact_address,
    privacy: { phoneVisibility: row.phone_visibility, phoneDisclosureConsent: row.phone_disclosure_consent },
})

const normalizeOptional = (value: unknown) => typeof value === 'string' ? value.trim() || null : value
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const updateProfile = async (user: AuthUser, input: Record<string, unknown>) => {
    const fields: Record<string, string | null | undefined> = {}
    for (const field of ['avatarUrl', 'nickname', 'bio', 'recoveryEmail', 'location', 'exactAddress']) {
        if (field in input) fields[field] = normalizeOptional(input[field]) as string | null
    }
    if (fields.nickname !== undefined && fields.nickname !== null && (fields.nickname.length < 2 || fields.nickname.length > 50)) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректне ім’я' } }
    if (fields.bio !== undefined && fields.bio !== null && fields.bio.length > 500) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Опис надто довгий' } }
    if (fields.recoveryEmail !== undefined && fields.recoveryEmail !== null && (fields.recoveryEmail.length > 254 || !emailPattern.test(fields.recoveryEmail))) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректна резервна електронна пошта' } }
    if (fields.avatarUrl !== undefined && fields.avatarUrl !== null && fields.avatarUrl.length > 2048) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректна адреса зображення' } }
    if (fields.location !== undefined && fields.location !== null && fields.location.length > 120) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Місцезнаходження надто довге' } }
    if (fields.exactAddress !== undefined && fields.exactAddress !== null && fields.exactAddress.length > 500) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Адреса надто довга' } }

    const columnNames: Record<string, string> = {
        avatarUrl: 'avatar_url', nickname: 'nickname', bio: 'bio', recoveryEmail: 'recovery_email',
        location: 'location_display', exactAddress: 'exact_address',
    }
    const values = Object.entries(fields).filter(([, value]) => value !== undefined)
    const assignments = values.map(([field], index) => `${columnNames[field]} = $${index + 1}`)
    const parameters = values.map(([, value]) => value)
    parameters.push(user.id)
    const result = await pool.query<ProfileRow>(
        `UPDATE users SET ${assignments.length ? `${assignments.join(', ')}, ` : ''}updated_at = now()
         WHERE id = $${parameters.length} RETURNING *`, parameters,
    )
    return { status: 200, body: { profile: toPrivateProfile(result.rows[0]) } }
}

export const updatePrivacy = async (user: AuthUser, input: Record<string, unknown>) => {
    const visibility = input.phoneVisibility
    const consent = input.phoneDisclosureConsent
    if (!['private', 'authenticated', 'public'].includes(String(visibility)) || typeof consent !== 'boolean') return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректні налаштування приватності' } }
    if (visibility !== 'private' && !consent) return { status: 400, body: { error: 'CONSENT_REQUIRED', message: 'Потрібна явна згода на розкриття номера телефону' } }
    const result = await pool.query<ProfileRow>(
        `UPDATE users SET phone_visibility = $1, phone_disclosure_consent = $2, updated_at = now() WHERE id = $3 RETURNING *`,
        [visibility, consent, user.id],
    )
    return { status: 200, body: { profile: toPrivateProfile(result.rows[0]) } }
}

export const getPublicProfile = async (username: string, request: Request) => {
    const result = await pool.query<ProfileRow>(`${profileSelect} WHERE username_normalized = $1`, [username.trim().toLowerCase()])
    const row = result.rows[0]
    if (!row) return { status: 404, body: { error: 'PROFILE_NOT_FOUND' } }
    const profile = toPublicProfile(row)
    if (row.phone_visibility === 'authenticated' && request.authUser) profile.phone = row.phone
    return { status: 200, body: { profile } }
}

export const getPrivateProfile = async (user: AuthUser) => {
    const result = await pool.query<ProfileRow>(`${profileSelect} WHERE id = $1`, [user.id])
    return { status: 200, body: { profile: toPrivateProfile(result.rows[0]) } }
}