import { expect, test, type Page } from '@playwright/test'

const user = { id: '11111111-1111-4111-8111-111111111111', username: 'review-fixture', countryCode: 'UA', phone: '+380501234567', email: 'review@example.invalid', emailVerified: true }
const privateAddress = 'Приватна вулиця 42, невідомий населений пункт'

async function fixtureApis(page: Page, profile?: Record<string, unknown>) {
  await page.addInitScript(() => localStorage.setItem('deshchotreba-onboarding-v1', 'done'))
  // Synthetic API data only: no account creation, real login or database access.
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const bodies: Record<string, unknown> = {
      '/api/auth/me': { user, sessionId: 'review-session' },
      '/api/profile/me': { profile: { ...user, avatarUrl: null, ...profile } },
      '/api/categories': { categories: [] },
      '/api/categories/popular': { categoryCounts: [] },
      '/api/map/markers': { markers: [], groups: [] },
      '/api/products': { products: [], pagination: { page: 1, pages: 1 } },
      '/api/products/mine': { products: [], pagination: { page: 1, pages: 1 } },
      '/api/conversations': { conversations: [] },
      '/api/favorites': { favorites: [] },
      '/api/notifications': { notifications: [], unreadCounts: { total: 0, buying: 0, selling: 0, legacy: 0 } },
      '/api/push/config': { enabled: false },
    }
    await route.fulfill({ status: !profile && path === '/api/auth/me' ? 401 : 200, contentType: 'application/json', body: JSON.stringify(bodies[path] ?? {}) })
  })
  await page.route(/^https:\/\//, route => route.abort())
}

for (const width of [390, 1280]) {
  test(`mobile destination URLs load and refresh without bypassing guest guards at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixtureApis(page)
    for (const path of ['/discover', '/favorites', '/my/products/new', '/my/requests/new', '/messages', '/cabinet', '/settings/profile']) {
      const response = await page.goto(path)
      expect(response?.status()).toBe(200)
      if (path !== '/discover') await expect(page.getByRole('heading', { name: 'Увійдіть, щоб відкрити цю сторінку' })).toBeVisible()
      else await expect(page.getByRole('button', { name: 'Визначити місто за IP через ipapi.is' })).toBeVisible()
      expect((await page.reload())?.status()).toBe(200)
      if (path !== '/discover') await expect(page.getByRole('heading', { name: 'Увійдіть, щоб відкрити цю сторінку' })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
    }
    await page.goto('/favorites')
    await page.getByRole('button', { name: 'Увійти або зареєструватися', exact: true }).click()
    await expect(page).toHaveURL(/\/auth\/login\?/)
    expect((await page.reload())?.status()).toBe(200)
    await expect(page.locator('form input[name="username"]')).toBeVisible()
    await page.screenshot({ path: test.info().outputPath('auth-route.png') })
  })

  for (const variant of ['legacy-address', 'unresolved-settlement', 'location-only']) {
    test(`private profile ${variant} never auto-geocodes; explicit GPS still works at ${width}px`, async ({ page, context }) => {
      await page.setViewportSize({ width, height: 900 })
      const profile = variant === 'location-only' ? { location: privateAddress } : {
        exactAddress: privateAddress, location: 'Невідоме місце',
        ...(variant === 'unresolved-settlement' ? {
          addressSettlement: { code: 'review', name: 'Приватний пункт', type: 'village', region: 'Область', district: 'Район', community: 'Громада' },
          addressCoordinates: { latitude: 50.45, longitude: 30.52 },
        } : { addressCoordinates: null }),
      }
      await fixtureApis(page, profile)
      const hereRequests: string[] = []
      await page.route('https://*.search.hereapi.com/**', async route => {
        hereRequests.push(route.request().url())
        await route.fulfill({ contentType: 'application/json', body: '{"items":[]}' })
      })
      const errors: string[] = []
      page.on('pageerror', error => errors.push(error.message))
      await page.goto('/discover')
      const gps = page.getByRole('button', { name: '⌖ Моє місце', exact: true })
      await expect(gps).toBeEnabled()
      if (variant !== 'location-only') await expect(page.getByRole('textbox', { name: 'Обрана адреса', exact: true })).toHaveValue(privateAddress)
      expect(hereRequests).toEqual([])
      // Positive control requires the fixture HERE key in the review build.
      await context.grantPermissions(['geolocation'])
      await context.setGeolocation({ latitude: 50.45, longitude: 30.52 })
      await gps.click()
      await expect.poll(() => hereRequests.length).toBe(1)
      const url = new URL(hereRequests[0])
      expect(url.hostname).toBe('revgeocode.search.hereapi.com')
      expect(url.searchParams.get('at')).toBe('50.45,30.52')
      expect(url.searchParams.has('q')).toBe(false)
      expect(hereRequests.join(' ')).not.toContain(encodeURIComponent(privateAddress))
      await expect(page.getByRole('textbox', { name: 'Обрана адреса', exact: true })).toHaveValue('Моє поточне місце')
      expect(errors).toEqual([])
      await page.screenshot({ path: test.info().outputPath('explicit-location.png') })
    })
  }

  test(`IP lookup can be retried after failure, without automatic retry at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    await fixtureApis(page)
    let requests = 0
    await page.route('https://api.ipapi.is/**', async route => {
      requests++
      await route.fulfill(requests === 1
        ? { status: 503, body: 'unavailable' }
        : { contentType: 'application/json', body: JSON.stringify({ location: { country_code: 'UA', city: 'Kyiv', latitude: 50.45, longitude: 30.52 } }) })
    })
    await page.goto('/discover')
    const button = page.getByRole('button', { name: 'Визначити місто за IP через ipapi.is', exact: true })
    await expect(button).toBeEnabled()
    expect(requests).toBe(0)
    await button.click()
    await expect(page.getByRole('status').filter({ hasText: 'Не вдалося визначити місто за IP' })).toBeVisible()
    expect(requests).toBe(1)
    await button.click()
    await expect(page.locator('.map-city-suggestion')).toContainText('Київ')
    expect(requests).toBe(2)
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  })
}
