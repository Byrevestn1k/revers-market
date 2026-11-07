import { test, expect } from '@playwright/test'

test('App logout from an old tab cannot revoke a newer session of the same account', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } })
    const origin = new URL(baseURL!).origin
    const user = { id: '11111111-1111-4111-8111-111111111111', username: 'qa-user', countryCode: 'UA', phone: '+380671111111', email: 'qa@example.test', emailVerified: true }
    let activeSession = 'S1'
    let deletePending = false
    let releaseDelete!: () => void
    const deleteReleased = new Promise<void>(resolve => { releaseDelete = resolve })
    let logoutBody: any
    let logoutStatus = 0

    await context.addCookies([{ name: 'qa-session', value: 'S1', url: origin }])
    await context.addInitScript(({ userId }) => {
        localStorage.setItem('deshchotreba.push.owner', userId)
        localStorage.setItem(`deshchotreba.push.binding.${userId}`, 'binding-s1')
        Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} })
        const sub = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }) }
        const worker = { getNotifications: async () => [], pushManager: { getSubscription: async () => sub } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => worker, register: async () => worker } })
    }, { userId: user.id })
    await context.route('**/second-tab', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await context.route('**/api/**', async route => {
        const request = route.request()
        const path = new URL(request.url()).pathname
        const cookie = request.headers().cookie || ''
        const session = cookie.includes('qa-session=S2') ? 'S2' : 'S1'
        if (path === '/api/auth/me') return route.fulfill({ json: { user, sessionId: session } })
        if (path === '/api/auth/login') {
            activeSession = 'S2'
            return route.fulfill({ headers: { 'Content-Type': 'application/json', 'Set-Cookie': 'qa-session=S2; Path=/; SameSite=Lax' }, body: JSON.stringify({ user, sessionId: 'S2' }) })
        }
        if (path === '/api/push/session') return route.fulfill({ json: { userId: user.id, sessionId: session } })
        if (path === '/api/push/config') return route.fulfill({ json: { enabled: true, publicKey: 'BA' } })
        if (path === '/api/push/status') return route.fulfill({ json: { active: true, binding: 'binding-s1' } })
        if (path === '/api/push/subscriptions' && request.method() === 'DELETE') {
            expect(request.postDataJSON()).toMatchObject({ expectedUserId: user.id, expectedSessionId: 'S1' })
            deletePending = true
            await deleteReleased
            return route.fulfill({ json: { binding: 'binding-s1' } })
        }
        if (path === '/api/auth/logout') {
            logoutBody = request.postDataJSON()
            logoutStatus = logoutBody.expectedSessionId === session && session === activeSession ? 204 : 409
            if (logoutStatus === 204) activeSession = ''
            return logoutStatus === 204 ? route.fulfill({ status: 204 }) : route.fulfill({ status: 409, json: { error: 'ACCOUNT_CHANGED' } })
        }
        if (path === '/api/categories') return route.fulfill({ json: { categories: [] } })
        if (path === '/api/products') return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } })
        if (path === '/api/products/mine') return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } })
        if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], unreadCounts: { total: 0, buying: 0, selling: 0, legacy: 0 } } })
        if (path === '/api/favorites') return route.fulfill({ json: { favorites: [] } })
        if (path === '/api/conversations') return route.fulfill({ json: { conversations: [] } })
        return route.fulfill({ json: {} })
    })

    try {
        const oldTab = await context.newPage()
        await oldTab.goto('/cabinet')
        await expect(oldTab.getByRole('heading', { name: 'Кабінет' })).toBeVisible()
        await oldTab.locator('.sidebar-exit').click()
        await expect.poll(() => deletePending).toBe(true)

        const newTab = await context.newPage()
        await newTab.goto('/second-tab')
        await newTab.evaluate(async () => { await fetch('/api/auth/login', { method: 'POST', credentials: 'include' }) })
        expect((await context.cookies()).find(cookie => cookie.name === 'qa-session')?.value).toBe('S2')

        releaseDelete()
        await expect.poll(() => logoutStatus).toBe(409)
        expect(logoutBody).toMatchObject({ expectedUserId: user.id, expectedSessionId: 'S1' })
        expect(activeSession).toBe('S2')
        expect((await context.cookies()).find(cookie => cookie.name === 'qa-session')?.value).toBe('S2')
        const fresh = await newTab.evaluate(async () => (await fetch('/api/auth/me', { credentials: 'include' })).json())
        expect(fresh.sessionId).toBe('S2')
    } finally {
        releaseDelete()
        await context.close()
    }
})
