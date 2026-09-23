import type { Request } from 'express'
import { pool } from './db/client.js'
import type { AuthUser } from './auth.js'
import { createEmailVerification, emailTaken, normalizeEmail, sendVerificationEmail } from './email-verification.js'
import { isValidEmail } from './validation.js'
import { getSettlement, validateSettlement, type Settlement } from './settlements.js'

type ProfileRow = {
    id: string
    username: string
    country_code: string
    phone: string
    phone_verified?: boolean
    email: string | null
    pending_email?: string | null
    email_verified: boolean
    avatar_url: string | null
    nickname: string | null
    bio: string | null
    recovery_email: string | null
    location_display: string | null
    exact_address: string | null
    settlement_code?: string | null
    address_settlement_code?: string | null
    address_latitude?: number | null
    address_longitude?: number | null
    map_location_mode?: 'approximate' | 'address' | 'pin'
    public_latitude?: string | number | null
    public_longitude?: string | number | null
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
    settlement?: Settlement | null
    phone: string | null
    exactAddress?: string | null
    mapLocation?: { mode: 'approximate' | 'address' | 'pin'; latitude: number | null; longitude: number | null; consent?: boolean }
    statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }
    ratingSummary: { average: number | null; count: number }
    createdAt: string
}

export type PrivateProfileDto = PublicProfileDto & {
    addressSettlement?: Settlement | null
    addressCoordinates?: { latitude: number; longitude: number } | null
    phone: string
    phoneVerified: boolean
    email: string | null
    emailVerified: boolean
    recoveryEmail: string | null
    exactAddress: string | null
    privacy: { phoneVisibility: ProfileRow['phone_visibility']; phoneDisclosureConsent: boolean }
}

const profileSelect = `
    SELECT id, username, country_code, phone, phone_verified, avatar_url, nickname, bio, recovery_email,
           email, email_verified, pending_email,
           location_display, exact_address, settlement_code, address_settlement_code, address_latitude, address_longitude, phone_visibility, phone_disclosure_consent,
           map_location_mode, public_latitude, public_longitude,
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
    settlement: getSettlement(row.settlement_code),
    ...(row.map_location_mode === 'address' ? { exactAddress: row.exact_address } : {}),
    ...(row.map_location_mode && row.map_location_mode !== 'approximate' ? { mapLocation: { mode: row.map_location_mode, latitude: Number(row.public_latitude), longitude: Number(row.public_longitude) } } : {}),
    phone: row.phone_visibility === 'public' && row.phone_disclosure_consent ? row.phone : null,
    statistics: { listingsCount: row.listings_count, completedDealsCount: row.completed_deals_count, responseRate: toNumberOrNull(row.response_rate) },
    ratingSummary: ratingSummary(row),
    createdAt: row.created_at.toISOString(),
})

export const toPrivateProfile = (row: ProfileRow): PrivateProfileDto => ({
    ...toPublicProfile(row),
    phone: row.phone,
    phoneVerified: Boolean(row.phone_verified),
    email: row.email ?? null,
    emailVerified: Boolean(row.email_verified),
    recoveryEmail: row.recovery_email,
    exactAddress: row.exact_address,
    addressSettlement: getSettlement(row.address_settlement_code),
    addressCoordinates: row.address_latitude != null && row.address_longitude != null ? { latitude: Number(row.address_latitude), longitude: Number(row.address_longitude) } : null,
    mapLocation: { mode: row.map_location_mode ?? 'approximate', latitude: row.public_latitude == null ? null : Number(row.public_latitude), longitude: row.public_longitude == null ? null : Number(row.public_longitude), consent: row.map_location_mode === 'address' || row.map_location_mode === 'pin' },
    privacy: { phoneVisibility: row.phone_visibility, phoneDisclosureConsent: row.phone_disclosure_consent },
})

const normalizeOptional = (value: unknown) => typeof value === 'string' ? value.trim() || null : value
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export const updateProfile = async (user: AuthUser, input: Record<string, unknown>) => {
    const fields: Record<string, string | null | undefined> = {}
    if (validateSettlement(input, 'location').length || (input.addressSettlementCode != null && !getSettlement(input.addressSettlementCode))) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Оберіть населений пункт із підказок' } }
    if ('settlementCode' in input) {
        fields.settlementCode = input.settlementCode as string | null
        if (getSettlement(input.settlementCode) && !('location' in input)) fields.location = getSettlement(input.settlementCode)!.name
    } else if ('location' in input) fields.settlementCode = null
    if ('addressSettlementCode' in input) fields.addressSettlementCode = input.addressSettlementCode as string | null
    else if ('exactAddress' in input) fields.addressSettlementCode = null
    if ('addressCoordinates' in input) {
        const point = input.addressCoordinates as { latitude?: unknown; longitude?: unknown } | null
        if (point !== null && (!point || typeof point.latitude !== 'number' || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180)) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректні координати адреси' } }
        fields.addressLatitude = point ? String(point.latitude) : null
        fields.addressLongitude = point ? String(point.longitude) : null
    } else if ('exactAddress' in input) { fields.addressLatitude = null; fields.addressLongitude = null }
    for (const field of ['avatarUrl', 'nickname', 'bio', 'recoveryEmail', 'location', 'exactAddress']) {
        if (field in input && input[field] !== null && typeof input[field] !== 'string') return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректне текстове поле профілю' } }
        if (field in input) fields[field] = normalizeOptional(input[field]) as string | null
    }

    // Зміна електронної пошти: валідація + унікальність; після збереження — новий лист підтвердження
    let pendingEmail: string | null = null
    if ('email' in input) {
        const rawEmail = normalizeOptional(input.email) as unknown
        const nextEmail = typeof rawEmail === 'string' ? rawEmail : null
        if (nextEmail === null) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Електронна пошта не може бути порожньою' } }
        if (!isValidEmail(nextEmail)) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректна електронна пошта' } }
        if (await emailTaken(nextEmail, user.id)) return { status: 409, body: { error: 'EMAIL_TAKEN', message: 'Ця електронна пошта вже зареєстрована' } }
        pendingEmail = normalizeEmail(nextEmail) === normalizeEmail(user.email ?? '') ? null : nextEmail
    }
    if (fields.nickname !== undefined && fields.nickname !== null && (fields.nickname.length < 2 || fields.nickname.length > 50)) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректне ім’я' } }
    if (fields.bio !== undefined && fields.bio !== null && fields.bio.length > 500) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Опис надто довгий' } }
    if (fields.recoveryEmail !== undefined && fields.recoveryEmail !== null && (fields.recoveryEmail.length > 254 || !emailPattern.test(fields.recoveryEmail))) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректна резервна електронна пошта' } }
    if (fields.avatarUrl !== undefined && fields.avatarUrl !== null && fields.avatarUrl.length > 2_000_000) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Зображення завелике' } }
    if (fields.location !== undefined && fields.location !== null && fields.location.length > 120) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Місцезнаходження надто довге' } }
    if (fields.exactAddress !== undefined && fields.exactAddress !== null && fields.exactAddress.length > 500) return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Адреса надто довга' } }

    if ('mapLocation' in input || 'exactAddress' in input) {
        const current = (await pool.query<ProfileRow>(`${profileSelect} WHERE id = $1`, [user.id])).rows[0]
        const invalid = (message: string) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message } })
        if ('mapLocation' in input) {
            const point = input.mapLocation as Record<string, unknown> | null
            if (!point || !['approximate', 'address', 'pin'].includes(String(point.mode))) return invalid('Оберіть спосіб показу на мапі')
            if (point.mode !== 'approximate') {
                if (point.consent !== true) return invalid('Підтвердіть згоду на публічний показ місця')
                if (typeof point.latitude !== 'number' || !Number.isFinite(point.latitude) || Math.abs(point.latitude) > 90 || typeof point.longitude !== 'number' || !Number.isFinite(point.longitude) || Math.abs(point.longitude) > 180) return invalid('Оберіть коректну точку на мапі')
                const address = fields.exactAddress === undefined ? current.exact_address : fields.exactAddress
                if (point.mode === 'address' && !address) return invalid('Спочатку оберіть точну адресу')
            }
            fields.mapMode = String(point.mode)
            fields.publicLatitude = point.mode === 'approximate' ? null : String(point.latitude)
            fields.publicLongitude = point.mode === 'approximate' ? null : String(point.longitude)
        } else if (current.map_location_mode === 'address' && fields.exactAddress !== current.exact_address) {
            // An address edit without newly confirmed coordinates revokes public sharing.
            fields.mapMode = 'approximate'; fields.publicLatitude = null; fields.publicLongitude = null
        }
    }
    const columnNames: Record<string, string> = {
        settlementCode: 'settlement_code', addressSettlementCode: 'address_settlement_code', addressLatitude: 'address_latitude', addressLongitude: 'address_longitude',
        mapMode: 'map_location_mode', publicLatitude: 'public_latitude', publicLongitude: 'public_longitude',
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
    let emailVerificationSent = false
    if (pendingEmail) {
        let token: string
        try { token = await createEmailVerification(user.id, pendingEmail) }
        catch (error) {
            if ((error as { code?: string }).code === '23505') return { status: 409, body: { error: 'EMAIL_TAKEN', message: 'Ця електронна пошта вже зареєстрована' } }
            throw error
        }
        try { emailVerificationSent = await sendVerificationEmail(pendingEmail, token) }
        catch { console.error('Verification email delivery failed') }
        const updated = await pool.query<ProfileRow>(`${profileSelect} WHERE id = $1`, [user.id])
        return { status: 200, body: { profile: toPrivateProfile(updated.rows[0]), emailVerificationSent } }
    }
    return { status: 200, body: { profile: toPrivateProfile(result.rows[0]), emailVerificationSent } }
}

export const updatePrivacy = async (user: AuthUser, input: Record<string, unknown>) => {
    const visibility = input.phoneVisibility
    const consent = input.phoneDisclosureConsent
    if (!['private', 'authenticated', 'public'].includes(String(visibility)) || typeof consent !== 'boolean') return { status: 400, body: { error: 'VALIDATION_ERROR', message: 'Некоректні налаштування приватності' } }
    const effectiveVisibility = consent ? visibility : 'private'
    const result = await pool.query<ProfileRow>(
        `UPDATE users SET phone_visibility = $1, phone_disclosure_consent = $2, updated_at = now() WHERE id = $3 RETURNING *`,
        [effectiveVisibility, consent, user.id],
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
