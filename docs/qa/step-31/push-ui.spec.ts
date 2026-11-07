import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const state = { prompt: 0, subscription: null as any, deleted: 0, granted: 'denied', serverActive: false, registrations: 0, closed: 0 }
        ;(window as any).__pushTest = state
        Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} })
        Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => { state.prompt++; return state.granted } } })
        const registration = { getNotifications: async () => [{ data: { binding: 'binding-a' }, close: () => { state.closed++ } }], pushManager: { getSubscription: async () => state.subscription, subscribe: async () => {
            state.subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => { state.subscription = null; return true } }
            return state.subscription
        } } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => registration, register: async () => registration } })
    })
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/push/config') return route.fulfill({ json: { enabled: true, publicKey: 'BA' } })
        if (path === '/api/push/session') return route.fulfill({ json: { userId: 'user-a', sessionId: 'session-a' } })
        if (path === '/api/push/status') return route.fulfill({ json: { active: await page.evaluate(() => (window as any).__pushTest.serverActive), binding: 'binding-a' } })
        if (path === '/api/push/subscriptions') { if (route.request().method() === 'DELETE') await page.evaluate(() => { (window as any).__pushTest.deleted++; (window as any).__pushTest.serverActive = false }); else await page.evaluate(() => { (window as any).__pushTest.registrations++; (window as any).__pushTest.serverActive = true }); return route.fulfill({ json: { binding: 'binding-a' } }) }
        return route.fulfill({ json: {} })
    })
    await page.route('**/push-fixture', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html><body><div id="root"></div>
      <script type="module">import RefreshRuntime from '/@react-refresh'; RefreshRuntime.injectIntoGlobalHook(window); window.$RefreshReg$ = () => {}; window.$RefreshSig$ = () => type => type; window.__vite_plugin_react_preamble_installed__ = true;</script>
      <script type="module" src="/push-ui-fixture.tsx"></script></body></html>` }))
})

test('permission is requested only on click and denial preserves in-app notifications', async ({ page }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__pushTest.prompt)).toBe(0)
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('status')).toContainText('Внутрішні сповіщення залишаються доступними')
    expect(await page.evaluate(() => (window as any).__pushTest.prompt)).toBe(1)
})

test('enable, disable and account mismatch revoke the old subscription', async ({ page }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    await page.evaluate(async () => { localStorage.setItem('deshchotreba.push.owner', 'other-user'); localStorage.setItem('deshchotreba.push.binding.other-user', 'binding-a'); const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).reconcilePushOwner('user-a', 'session-a') })
    expect(await page.evaluate(() => (window as any).__pushTest.deleted)).toBe(1)
    expect(await page.evaluate(() => (window as any).__pushTest.subscription)).not.toBeNull()
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(1)
})

test('unsupported device does not offer push', async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).PushManager })
    await page.goto('/push-fixture')
    await expect(page.getByText('Сповіщення на цьому пристрої зараз недоступні', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toHaveCount(0)
})

test('logout disconnect revokes server delivery and closes its notification', async ({ page }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).disconnectPush('user-a', 'session-a') })
    expect(await page.evaluate(() => (window as any).__pushTest.deleted)).toBe(1)
    expect(await page.evaluate(() => (window as any).__pushTest.subscription)).not.toBeNull()
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(1)
})

test('expired session subscription does not appear enabled and requires explicit reconnection', async ({ page }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    await page.evaluate(() => { (window as any).__pushTest.serverActive = false; window.dispatchEvent(new Event('focus')) })
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__pushTest.registrations)).toBe(1)
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    expect(await page.evaluate(() => (window as any).__pushTest.registrations)).toBe(2)
})

test('stale tab cannot remove another account subscription or close its notification', async ({ page, context }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    const second = await context.newPage()
    await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await second.goto('/push-second')
    await context.addCookies([{ name: 'qa-session', value: 'user-b', url: new URL(page.url()).origin }])
    await second.evaluate(() => { localStorage.setItem('deshchotreba.push.owner', 'user-b'); localStorage.setItem('deshchotreba.push.binding.user-b', 'binding-b') })
    await page.evaluate(() => {
        const state = (window as any).__pushTest
        state.subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => { state.subscription = null } }
        const worker = { getNotifications: async () => [{ data: { binding: 'binding-b' }, close: () => { state.closed++ } }], pushManager: { getSubscription: async () => state.subscription } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => worker } })
    })
    await page.route('**/api/push/session', async route => {
        const cookie = route.request().headers().cookie || ''
        return route.fulfill({ json: { userId: cookie.includes('qa-session=user-b') ? 'user-b' : 'user-a', sessionId: 'session-a' } })
    })
    await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).reconcilePushOwner('user-a', 'session-a').catch(() => undefined) })
    expect(await page.evaluate(() => (window as any).__pushTest.deleted)).toBe(0)
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(0)
    expect(await page.evaluate(() => (window as any).__pushTest.subscription)).not.toBeNull()
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.owner'))).toBe('user-b')
    await second.close()
})

test('missing local subscription still closes notifications for the current account', async ({ page }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    await page.evaluate(async () => {
        localStorage.setItem('deshchotreba.push.owner', 'user-a')
        localStorage.setItem('deshchotreba.push.binding.user-a', 'binding-a')
        const load = new Function('return import("/src/push-notifications.tsx")')
        await (await load()).reconcilePushOwner('user-a', 'session-a')
    })
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(1)
})

for (const hasSubscription of [false, true]) {
    test(`account switch closes only the old binding when subscription ${hasSubscription ? 'remains' : 'is missing'}`, async ({ page, context }) => {
        await page.goto('/push-fixture')
        await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
        const second = await context.newPage()
        await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
        await second.goto('/push-second')
        await context.addCookies([{ name: 'qa-session', value: 'user-b', url: new URL(page.url()).origin }])
        await page.route('**/api/push/session', route => route.fulfill({ json: { userId: 'user-b', sessionId: 'session-b' } }))
        await page.route('**/api/push/subscriptions', route => route.fulfill({ json: { binding: null } }))
        await page.evaluate((withSubscription) => {
            const state = (window as any).__pushTest
            state.closedNew = 0
            state.subscription = withSubscription ? { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }) } : null
            const worker = { getNotifications: async () => [
                { data: { binding: 'binding-a' }, close: () => { state.closed++ } },
                { data: { binding: 'binding-b' }, close: () => { state.closedNew++ } },
            ], pushManager: { getSubscription: async () => state.subscription } }
            Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => worker } })
            localStorage.setItem('deshchotreba.push.owner', 'user-a')
            localStorage.setItem('deshchotreba.push.binding.user-a', 'binding-a')
        }, hasSubscription)
        await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).reconcilePushOwner('user-b', 'session-b') })
        expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(1)
        expect(await page.evaluate(() => (window as any).__pushTest.closedNew)).toBe(0)
        expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.owner'))).toBeNull()
        await second.close()
    })
}

test('old session of the same account cannot close new session notifications', async ({ page }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    await page.route('**/api/push/session', route => route.fulfill({ json: { userId: 'user-a', sessionId: 'session-new' } }))
    await page.evaluate(() => {
        const state = (window as any).__pushTest
        const worker = { getNotifications: async () => [{ data: { binding: 'binding-new' }, close: () => { state.closed++ } }], pushManager: { getSubscription: async () => null } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => worker } })
        localStorage.setItem('deshchotreba.push.owner', 'user-a')
        localStorage.setItem('deshchotreba.push.binding.user-a', 'binding-new')
    })
    await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).reconcilePushOwner('user-a', 'session-a').catch(() => undefined) })
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(0)
    expect(await page.evaluate(() => localStorage.getItem('deshchotreba.push.binding.user-a'))).toBe('binding-new')
})

test('in-flight old account deletion cannot close new account notifications', async ({ page, context }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    const second = await context.newPage()
    await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await second.goto('/push-second')
    await page.evaluate(() => {
        const state = (window as any).__pushTest
        const worker = { getNotifications: async () => [{ data: { binding: 'binding-b' }, close: () => { state.closed++ } }], pushManager: { getSubscription: async () => state.subscription } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => worker } })
    })
    let pending = false
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/push/subscriptions', async route => {
        if (route.request().method() !== 'DELETE') return route.fallback()
        expect(route.request().postDataJSON()).toMatchObject({ expectedUserId: 'user-a', expectedBinding: 'binding-a' })
        pending = true
        await released
        await route.fulfill({ json: { binding: null } }) // CAS did not match after B registered.
    })
    const deleting = page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).disconnectPush('user-a', 'session-a') })
    await expect.poll(() => pending).toBe(true)
    await context.addCookies([{ name: 'qa-session', value: 'user-b', url: new URL(page.url()).origin }])
    await second.evaluate(() => { localStorage.setItem('deshchotreba.push.binding.user-b', 'binding-b'); localStorage.setItem('deshchotreba.push.owner', 'user-b') })
    release()
    await deleting
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(0)
    expect(await page.evaluate(() => (window as any).__pushTest.subscription)).not.toBeNull()
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.owner'))).toBe('user-b')
    await second.close()
})

test('late status for an old session cannot close the same account’s new binding', async ({ page, context }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    const second = await context.newPage()
    await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await second.goto('/push-second')
    await page.evaluate(() => {
        const state = (window as any).__pushTest
        state.closedNew = 0
        const worker = { getNotifications: async () => [
            { data: { binding: 'binding-a' }, close: () => { state.closed++ } },
            { data: { binding: 'binding-new' }, close: () => { state.closedNew++ } },
        ], pushManager: { getSubscription: async () => state.subscription } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => worker } })
    })
    let pending = false
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/push/status', async route => {
        if (pending) return route.fulfill({ json: { active: true, binding: 'binding-new' } })
        pending = true
        await released
        return route.fulfill({ json: { active: false, binding: null } })
    })
    await page.evaluate(() => window.dispatchEvent(new Event('focus')))
    await expect.poll(() => pending).toBe(true)
    await second.evaluate(() => localStorage.setItem('deshchotreba.push.binding.user-a', 'binding-new'))
    release()
    await expect.poll(() => page.evaluate(() => (window as any).__pushTest.closed)).toBe(1)
    expect(await page.evaluate(() => (window as any).__pushTest.closedNew)).toBe(0)
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.binding.user-a'))).toBe('binding-new')
    await second.close()
})

test('explicit disconnect without binding refuses deletion if server has no active subscription', async ({ page }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    await page.evaluate(() => {
        const state = (window as any).__pushTest
        state.subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }) }
        localStorage.setItem('deshchotreba.push.owner', 'user-a')
        localStorage.removeItem('deshchotreba.push.binding.user-a')
    })
    let body: Record<string, unknown> | undefined
    await page.route('**/api/push/subscriptions', async route => { body = route.request().postDataJSON(); await route.fulfill({ json: { binding: null } }) })
    const rejected = await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); try { await (await load()).disconnectPush('user-a', 'session-a'); return false } catch { return true } })
    expect(rejected).toBe(true)
    expect(body).toBeUndefined()
})

test('explicit disconnect without local binding uses server status and CAS', async ({ page }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    await page.evaluate(() => {
        const state = (window as any).__pushTest
        state.serverActive = true
        state.subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }) }
        localStorage.setItem('deshchotreba.push.owner', 'user-a')
        localStorage.removeItem('deshchotreba.push.binding.user-a')
    })
    let body: Record<string, unknown> | undefined
    await page.route('**/api/push/subscriptions', async route => { body = route.request().postDataJSON(); await route.fulfill({ json: { binding: 'binding-a' } }) })
    await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).disconnectPush('user-a', 'session-a') })
    expect(body).toMatchObject({ expectedUserId: 'user-a', expectedSessionId: 'session-a', expectedBinding: 'binding-a' })
    expect(await page.evaluate(() => (window as any).__pushTest.closed)).toBe(1)
})

test('empty reconciliation snapshot cannot delete a subscription created by another tab', async ({ page, context }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    const second = await context.newPage()
    await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await second.goto('/push-second')
    let deleted = 0
    await page.route('**/api/push/subscriptions', async route => { if (route.request().method() === 'DELETE') deleted++; await route.fulfill({ json: { binding: 'binding-new' } }) })
    await page.evaluate(async () => {
        localStorage.removeItem('deshchotreba.push.owner')
        localStorage.removeItem('deshchotreba.push.binding.user-a')
        const load = new Function('return import("/src/push-notifications.tsx")')
        ;(window as any).__reconciliation = (await load()).reconcilePushOwner('user-a', 'session-a')
    })
    await second.evaluate(() => { localStorage.setItem('deshchotreba.push.binding.user-a', 'binding-new'); localStorage.setItem('deshchotreba.push.owner', 'user-a') })
    await page.evaluate(async () => { (window as any).__pushTest.subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }) }; await (window as any).__reconciliation })
    expect(deleted).toBe(0)
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.binding.user-a'))).toBe('binding-new')
    await second.close()
})

test('late delete preserves a newer binding for the same account', async ({ page, context }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    const second = await context.newPage()
    await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await second.goto('/push-second')
    await page.route('**/api/push/status', route => route.fulfill({ json: { active: true, binding: 'binding-new' } }))
    let pending = false
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/push/subscriptions', async route => { pending = true; await released; await route.fulfill({ json: { binding: null } }) })
    const deleting = page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).disconnectPush('user-a', 'session-a') })
    await expect.poll(() => pending).toBe(true)
    await second.evaluate(() => localStorage.setItem('deshchotreba.push.binding.user-a', 'binding-new'))
    release()
    await deleting
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.owner'))).toBe('user-a')
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.binding.user-a'))).toBe('binding-new')
    await second.close()
})

test('late registration response cannot overwrite a newer account binding', async ({ page, context }) => {
    await page.goto('/push-fixture')
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toBeVisible()
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    const second = await context.newPage()
    await second.route('**/push-second', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>Second tab</title>' }))
    await second.goto('/push-second')
    let pending = false
    let release!: () => void
    const released = new Promise<void>(resolve => { release = resolve })
    await page.route('**/api/push/subscriptions', async route => {
        expect(route.request().method()).toBe('POST')
        pending = true
        await released
        await route.fulfill({ json: { binding: 'binding-a' } })
    })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect.poll(() => pending).toBe(true)
    await context.addCookies([{ name: 'qa-session', value: 'user-b', url: new URL(page.url()).origin }])
    await second.evaluate(() => { localStorage.setItem('deshchotreba.push.binding.user-b', 'binding-b'); localStorage.setItem('deshchotreba.push.owner', 'user-b') })
    release()
    await expect(page.getByRole('status')).toContainText('Не вдалося увімкнути')
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.owner'))).toBe('user-b')
    expect(await second.evaluate(() => localStorage.getItem('deshchotreba.push.binding.user-b'))).toBe('binding-b')
    await second.close()
})
