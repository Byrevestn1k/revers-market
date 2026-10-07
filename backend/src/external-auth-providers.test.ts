import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { exportJWK, generateKeyPair, SignJWT } from 'jose'
import { authorizationUrl, exchangeProfile, verifyOidcToken } from './external-auth-providers.js'

describe('external provider security', () => {
    it('binds state, PKCE and nonce in Google and Telegram requests', () => {
        for (const provider of ['google', 'telegram'] as const) {
            const url = new URL(authorizationUrl(provider, { clientId: 'client', clientSecret: 'secret', callbackUrl: 'https://example.com/api/callback' }, 'state-value', 'verifier-value', 'nonce-value'))
            expect(url.searchParams.get('state')).toBe('state-value')
            expect(url.searchParams.get('nonce')).toBe('nonce-value')
            expect(url.searchParams.get('code_challenge_method')).toBe('S256')
            expect(url.searchParams.get('scope')).not.toContain('phone')
            expect(url.searchParams.get('scope')).not.toContain('telegram:bot_access')
        }
    })

    it('verifies cryptographic signature, issuer, audience, expiry and nonce', async () => {
        const { publicKey, privateKey } = await generateKeyPair('RS256')
        const other = await generateKeyPair('RS256')
        const make = (issuer = 'https://oauth.telegram.org', audience = 'client', nonce = 'one', expiry = '5m') =>
            new SignJWT({ nonce, sub: 'stable-subject' }).setProtectedHeader({ alg: 'RS256' }).setIssuer(issuer)
                .setAudience(audience).setIssuedAt().setExpirationTime(expiry).sign(privateKey)
        const valid = await make()
        expect((await verifyOidcToken(valid, publicKey, 'https://oauth.telegram.org', 'client', 'one')).sub).toBe('stable-subject')
        await expect(verifyOidcToken(valid, other.publicKey, 'https://oauth.telegram.org', 'client', 'one')).rejects.toThrow()
        await expect(verifyOidcToken(valid, publicKey, 'https://wrong.example', 'client', 'one')).rejects.toThrow()
        await expect(verifyOidcToken(valid, publicKey, 'https://oauth.telegram.org', 'wrong', 'one')).rejects.toThrow()
        await expect(verifyOidcToken(valid, publicKey, 'https://oauth.telegram.org', 'client', 'wrong')).rejects.toThrow()
        await expect(verifyOidcToken(await make('https://oauth.telegram.org', 'client', 'one', '-1m'), publicKey, 'https://oauth.telegram.org', 'client', 'one')).rejects.toThrow()
    }, 30000)
})

describe('Google and Telegram ID tokens through provider exchange', () => {
    const config = { clientId: 'test-client', clientSecret: 'test-secret', callbackUrl: 'https://marketplace.example/callback' }
    let keys: Record<'google' | 'telegram', Awaited<ReturnType<typeof generateKeyPair>>>
    let jwks: Record<'google' | 'telegram', { keys: Record<string, unknown>[] }>
    let servedToken = ''
    const issuer = (provider: 'google' | 'telegram') => provider === 'google' ? 'https://accounts.google.com' : 'https://oauth.telegram.org'
    const sign = (provider: 'google' | 'telegram', claims: Record<string, unknown>, options: { issuer?: string; audience?: string; nonce?: string } = {}) =>
        new SignJWT({ sub: 'stable-provider-id', nonce: options.nonce ?? 'expected-nonce', ...claims })
            .setProtectedHeader({ alg: 'RS256', kid: `${provider}-test` })
            .setIssuer(options.issuer ?? issuer(provider)).setAudience(options.audience ?? config.clientId)
            .sign(keys[provider].privateKey)
    const exchange = async (provider: 'google' | 'telegram', token: string) => {
        servedToken = token
        return exchangeProfile(provider, config, 'test-code', 'test-verifier', 'expected-nonce')
    }

    beforeAll(async () => {
        keys = { google: await generateKeyPair('RS256'), telegram: await generateKeyPair('RS256') }
        jwks = {
            google: { keys: [{ ...await exportJWK(keys.google.publicKey), kid: 'google-test', alg: 'RS256', use: 'sig' }] },
            telegram: { keys: [{ ...await exportJWK(keys.telegram.publicKey), kid: 'telegram-test', alg: 'RS256', use: 'sig' }] },
        }
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
            if (url.hostname === 'www.googleapis.com' && url.pathname === '/oauth2/v3/certs') return Response.json(jwks.google)
            if (url.hostname === 'oauth.telegram.org' && url.pathname === '/.well-known/jwks.json') return Response.json(jwks.telegram)
            if ((url.hostname === 'oauth2.googleapis.com' || url.hostname === 'oauth.telegram.org') && url.pathname === '/token') return Response.json({ id_token: servedToken })
            throw new Error(`Unexpected provider request: ${url.origin}${url.pathname}`)
        }))
    })
    afterAll(() => vi.unstubAllGlobals())

    for (const provider of ['google', 'telegram'] as const) {
        it(`${provider} accepts a valid token with exp and iat`, async () => {
            const now = Math.floor(Date.now() / 1000)
            const result = await exchange(provider, await sign(provider, { iat: now, exp: now + 300 }))
            expect(result).toMatchObject({ provider, providerUserId: 'stable-provider-id' })
        })

        it(`${provider} accepts iat within clock skew and rejects a future iat`, async () => {
            const now = Math.floor(Date.now() / 1000)
            await expect(exchange(provider, await sign(provider, { iat: now + 60, exp: now + 360 }))).resolves.toMatchObject({ provider })
            await expect(exchange(provider, await sign(provider, { iat: now + 61, exp: now + 361 }))).rejects.toThrow()
        })

        it.each([
            ['missing exp', (claims: Record<string, unknown>) => { delete claims.exp }],
            ['missing iat', (claims: Record<string, unknown>) => { delete claims.iat }],
            ['expired exp', (claims: Record<string, unknown>) => { claims.exp = Math.floor(Date.now() / 1000) - 60 }],
            ['malformed exp', (claims: Record<string, unknown>) => { claims.exp = 'tomorrow' }],
            ['malformed iat', (claims: Record<string, unknown>) => { claims.iat = 'yesterday' }],
            ['unsafe numeric exp', (claims: Record<string, unknown>) => { claims.exp = 1e20 }],
            ['unsafe numeric iat', (claims: Record<string, unknown>) => { claims.iat = 1e20 }],
        ])(`${provider} rejects %s`, async (_case, change) => {
            const now = Math.floor(Date.now() / 1000)
            const claims: Record<string, unknown> = { iat: now, exp: now + 300 }
            change(claims)
            await expect(exchange(provider, await sign(provider, claims))).rejects.toThrow()
        })

        it(`${provider} still rejects wrong issuer, audience and nonce`, async () => {
            const now = Math.floor(Date.now() / 1000)
            const claims = { iat: now, exp: now + 300 }
            await expect(exchange(provider, await sign(provider, claims, { issuer: 'https://wrong.example' }))).rejects.toThrow()
            await expect(exchange(provider, await sign(provider, claims, { audience: 'wrong-client' }))).rejects.toThrow()
            await expect(exchange(provider, await sign(provider, claims, { nonce: 'wrong-nonce' }))).rejects.toThrow()
        })
    }
})

describe('Facebook provider verification', () => {
    const config = { clientId: 'facebook-client', clientSecret: 'facebook-secret', callbackUrl: 'https://marketplace.example/callback' }
    const profile = { id: 'facebook-user', name: 'Facebook User' }
    const installFetch = (debug: Record<string, unknown>, me: Record<string, unknown> = profile, failed = false) => {
        vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
            const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url)
            if (failed) return new Response('', { status: 500 })
            if (url.pathname.endsWith('/oauth/access_token')) return Response.json({ access_token: 'access-token' })
            if (url.pathname.endsWith('/debug_token')) return Response.json({ data: debug })
            if (url.pathname.endsWith('/me')) return Response.json(me)
            throw new Error(`Unexpected provider request: ${url.pathname}`)
        }))
    }
    afterEach(() => vi.unstubAllGlobals())

    it.each([
        ['an invalid debug token', { is_valid: false, app_id: config.clientId, user_id: profile.id }],
        ['a debug token for another app', { is_valid: true, app_id: 'other-app', user_id: profile.id }],
    ])('rejects %s', async (_case, debug) => {
        installFetch(debug)
        await expect(exchangeProfile('facebook', config, 'code', 'unused', 'unused')).rejects.toThrow()
    })

    it('rejects a Facebook profile whose id does not match debug_token', async () => {
        installFetch({ is_valid: true, app_id: config.clientId, user_id: profile.id }, { ...profile, id: 'other-user' })
        await expect(exchangeProfile('facebook', config, 'code', 'unused', 'unused')).rejects.toThrow()
    })

    it('rejects a failed Facebook provider request', async () => {
        installFetch({}, profile, true)
        await expect(exchangeProfile('facebook', config, 'code', 'unused', 'unused')).rejects.toThrow('PROVIDER_RESPONSE_FAILED')
    })
})
