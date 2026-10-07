import { createHash, createHmac } from 'node:crypto'
import { createRemoteJWKSet, jwtVerify } from 'jose'

export const providers = ['google', 'facebook', 'telegram'] as const
export type AuthProvider = typeof providers[number]
export type ExternalProfile = {
    provider: AuthProvider
    providerUserId: string
    email: string | null
    emailVerified: boolean
    username: string | null
    displayName: string | null
    avatarUrl: string | null
}

type ProviderConfig = { clientId: string; clientSecret: string; callbackUrl: string }
const configNames: Record<AuthProvider, [string, string]> = {
    google: ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET'],
    facebook: ['FACEBOOK_CLIENT_ID', 'FACEBOOK_CLIENT_SECRET'],
    telegram: ['TELEGRAM_CLIENT_ID', 'TELEGRAM_CLIENT_SECRET'],
}

export const isProvider = (value: string): value is AuthProvider => providers.includes(value as AuthProvider)

export const providerConfig = (provider: AuthProvider): ProviderConfig | null => {
    const [idName, secretName] = configNames[provider]
    const clientId = process.env[idName]?.trim()
    const clientSecret = process.env[secretName]?.trim()
    const apiUrl = process.env.PUBLIC_API_URL?.trim()
    if (!clientId || !clientSecret || !apiUrl) return null
    let callbackUrl: string
    try {
        const parsed = new URL(apiUrl)
        if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) return null
        if (process.env.NODE_ENV === 'production' && parsed.protocol !== 'https:') return null
        if (process.env.FRONTEND_URL && new URL(process.env.FRONTEND_URL).origin !== parsed.origin) return null
        callbackUrl = new URL(`/api/auth/external/${provider}/callback`, parsed).toString()
    } catch { return null }
    return { clientId, clientSecret, callbackUrl }
}

export const providerAvailability = () => Object.fromEntries(providers.map(provider => [provider, Boolean(providerConfig(provider))]))

const facebookVersion = () => /^v\d+\.\d+$/.test(process.env.FACEBOOK_GRAPH_VERSION ?? '') ? process.env.FACEBOOK_GRAPH_VERSION! : 'v23.0'

export const authorizationUrl = (provider: AuthProvider, config: ProviderConfig, state: string, verifier: string, nonce: string) => {
    const challenge = createHash('sha256').update(verifier).digest('base64url')
    const url = new URL(provider === 'google' ? 'https://accounts.google.com/o/oauth2/v2/auth'
        : provider === 'telegram' ? 'https://oauth.telegram.org/auth'
            : `https://www.facebook.com/${facebookVersion()}/dialog/oauth`)
    url.searchParams.set('client_id', config.clientId)
    url.searchParams.set('redirect_uri', config.callbackUrl)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    url.searchParams.set('scope', provider === 'google' ? 'openid profile email' : provider === 'telegram' ? 'openid profile' : 'public_profile,email')
    if (provider !== 'facebook') {
        url.searchParams.set('code_challenge', challenge)
        url.searchParams.set('code_challenge_method', 'S256')
        url.searchParams.set('nonce', nonce)
    }
    return url.toString()
}

const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
const telegramKeys = createRemoteJWKSet(new URL('https://oauth.telegram.org/.well-known/jwks.json'))

const readJson = async (url: string, options?: RequestInit): Promise<Record<string, unknown>> => {
    const response = await fetch(url, { ...options, signal: AbortSignal.timeout(8000) })
    if (!response.ok) throw new Error('PROVIDER_RESPONSE_FAILED')
    const data: unknown = await response.json()
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('PROVIDER_RESPONSE_FAILED')
    return data as Record<string, unknown>
}

const textOrNull = (value: unknown, limit = 255) => typeof value === 'string' && value.trim() ? value.trim().slice(0, limit) : null
const validNumericDate = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= Number.MAX_SAFE_INTEGER
export const OIDC_CLOCK_SKEW_SECONDS = 60

export const verifyOidcToken = async (token: string, key: Parameters<typeof jwtVerify>[1], issuer: string | string[], audience: string, nonce: string) => {
    const { payload } = await jwtVerify(token, key, { issuer, audience, algorithms: ['RS256', 'ES256'], clockTolerance: OIDC_CLOCK_SKEW_SECONDS,
        requiredClaims: ['exp', 'iat'] })
    const issuedAt = payload.iat
    if (!validNumericDate(payload.exp) || typeof issuedAt !== 'number' || !validNumericDate(issuedAt)) throw new Error('INVALID_PROVIDER_TOKEN')
    if (issuedAt > Math.floor(Date.now() / 1000) + OIDC_CLOCK_SKEW_SECONDS) throw new Error('INVALID_PROVIDER_TOKEN')
    if (payload.nonce !== nonce || typeof payload.sub !== 'string' || !payload.sub) throw new Error('INVALID_PROVIDER_TOKEN')
    return payload as typeof payload & { sub: string }
}

export const exchangeProfile = async (provider: AuthProvider, config: ProviderConfig, code: string, verifier: string, nonce: string): Promise<ExternalProfile> => {
    if (provider === 'facebook') {
        const tokenUrl = new URL(`https://graph.facebook.com/${facebookVersion()}/oauth/access_token`)
        tokenUrl.searchParams.set('client_id', config.clientId)
        tokenUrl.searchParams.set('client_secret', config.clientSecret)
        tokenUrl.searchParams.set('redirect_uri', config.callbackUrl)
        tokenUrl.searchParams.set('code', code)
        const token = await readJson(tokenUrl.toString())
        if (typeof token.access_token !== 'string') throw new Error('INVALID_PROVIDER_TOKEN')
        const accessToken = token.access_token
        const appToken = `${config.clientId}|${config.clientSecret}`
        const debugUrl = new URL(`https://graph.facebook.com/${facebookVersion()}/debug_token`)
        debugUrl.searchParams.set('input_token', accessToken)
        debugUrl.searchParams.set('access_token', appToken)
        const debug = await readJson(debugUrl.toString())
        const claim = debug.data as Record<string, unknown> | undefined
        if (!claim?.is_valid || String(claim.app_id) !== config.clientId || typeof claim.user_id !== 'string' || (typeof claim.expires_at === 'number' && claim.expires_at <= Date.now() / 1000)) throw new Error('INVALID_PROVIDER_TOKEN')
        const meUrl = new URL(`https://graph.facebook.com/${facebookVersion()}/me`)
        meUrl.searchParams.set('fields', 'id,name,email,picture.type(square)')
        meUrl.searchParams.set('access_token', accessToken)
        meUrl.searchParams.set('appsecret_proof', createHmac('sha256', config.clientSecret).update(accessToken).digest('hex'))
        const me = await readJson(meUrl.toString())
        if (me.id !== claim.user_id) throw new Error('INVALID_PROVIDER_TOKEN')
        const picture = me.picture as { data?: { url?: unknown } } | undefined
        return { provider, providerUserId: claim.user_id, email: textOrNull(me.email), emailVerified: false,
            username: null, displayName: textOrNull(me.name), avatarUrl: textOrNull(picture?.data?.url, 2000) }
    }

    const tokenEndpoint = provider === 'google' ? 'https://oauth2.googleapis.com/token' : 'https://oauth.telegram.org/token'
    const body = new URLSearchParams({ grant_type: 'authorization_code', code, redirect_uri: config.callbackUrl,
        client_id: config.clientId, code_verifier: verifier })
    const headers: Record<string, string> = { 'Content-Type': 'application/x-www-form-urlencoded' }
    if (provider === 'google') body.set('client_secret', config.clientSecret)
    else headers.Authorization = `Basic ${Buffer.from(`${config.clientId}:${config.clientSecret}`).toString('base64')}`
    const token = await readJson(tokenEndpoint, { method: 'POST', headers, body })
    if (typeof token.id_token !== 'string') throw new Error('INVALID_PROVIDER_TOKEN')
    const issuer = provider === 'google' ? ['https://accounts.google.com', 'accounts.google.com'] : 'https://oauth.telegram.org'
    const payload = await verifyOidcToken(token.id_token, provider === 'google' ? googleKeys : telegramKeys, issuer, config.clientId, nonce)
    return { provider, providerUserId: payload.sub, email: textOrNull(payload.email), emailVerified: payload.email_verified === true,
        username: textOrNull(payload.preferred_username), displayName: textOrNull(payload.name), avatarUrl: textOrNull(payload.picture, 2000) }
}
