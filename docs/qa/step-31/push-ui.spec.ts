import { test, expect } from '@playwright/test'

test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
        const state = { prompt: 0, subscription: null as any, deleted: 0, granted: 'denied' }
        ;(window as any).__pushTest = state
        Object.defineProperty(window, 'PushManager', { configurable: true, value: function () {} })
        Object.defineProperty(window, 'Notification', { configurable: true, value: { requestPermission: async () => { state.prompt++; return state.granted } } })
        const registration = { pushManager: { getSubscription: async () => state.subscription, subscribe: async () => {
            state.subscription = { endpoint: 'https://push.example/sub', toJSON: () => ({ endpoint: 'https://push.example/sub', keys: { p256dh: 'test', auth: 'test' } }), unsubscribe: async () => { state.subscription = null; return true } }
            return state.subscription
        } } }
        Object.defineProperty(navigator, 'serviceWorker', { configurable: true, value: { getRegistration: async () => registration, register: async () => registration } })
    })
    await page.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname
        if (path === '/api/push/config') return route.fulfill({ json: { enabled: true, publicKey: 'BA' } })
        if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'user-a' } } })
        if (path === '/api/push/subscriptions') { if (route.request().method() === 'DELETE') await page.evaluate(() => { (window as any).__pushTest.deleted++ }); return route.fulfill({ json: { ok: true } }) }
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
    await page.evaluate(async () => { localStorage.setItem('deshchotreba.push.owner', 'other-user'); const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).reconcilePushOwner('user-a') })
    expect(await page.evaluate(() => (window as any).__pushTest.deleted)).toBe(1)
    expect(await page.evaluate(() => (window as any).__pushTest.subscription)).toBeNull()
})

test('unsupported device does not offer push', async ({ page }) => {
    await page.addInitScript(() => { delete (window as any).PushManager })
    await page.goto('/push-fixture')
    await expect(page.getByText('Сповіщення на цьому пристрої зараз недоступні', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Увімкнути сповіщення' })).toHaveCount(0)
})

test('logout disconnect revokes and unsubscribes the device', async ({ page }) => {
    await page.goto('/push-fixture')
    await page.evaluate(() => { (window as any).__pushTest.granted = 'granted' })
    await page.getByRole('button', { name: 'Увімкнути сповіщення' }).click()
    await expect(page.getByRole('button', { name: 'Вимкнути сповіщення' })).toBeVisible()
    await page.evaluate(async () => { const load = new Function('return import("/src/push-notifications.tsx")'); await (await load()).disconnectPush() })
    expect(await page.evaluate(() => (window as any).__pushTest.deleted)).toBe(1)
    expect(await page.evaluate(() => (window as any).__pushTest.subscription)).toBeNull()
})
