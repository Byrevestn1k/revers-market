import { createApp } from '../../backend/src/app.js'
import type { ExternalProfile } from '../../backend/src/external-auth-providers.js'

const port = Number(process.env.E2E_API_PORT ?? 3020)
const app = createApp({ providerExchange: async (provider, _config, code): Promise<ExternalProfile> => {
    if (!/^e2e-[a-z0-9-]{1,80}$/.test(code)) throw new Error('INVALID_TEST_CODE')
    return {
        provider,
        providerUserId: code,
        email: provider === 'telegram' ? null : `${code}@example.invalid`,
        emailVerified: provider === 'google',
        username: code,
        displayName: `E2E ${provider}`,
        avatarUrl: null,
    }
} })

app.listen(port, '127.0.0.1', () => console.log(`External auth E2E API listening on 127.0.0.1:${port}`))
