import { test, expect, type Page } from '@playwright/test'
import { legalDocuments } from '../frontend/src/legal-content'

async function fixtureApis(page: Page) {
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const bodies: Record<string, unknown> = {
      '/api/categories': { categories: [] },
      '/api/categories/popular': { categoryCounts: [] },
      '/api/map/markers': { markers: [], groups: [] },
      '/api/products': { products: [], pagination: { page: 1, pages: 1 } },
    }
    await route.fulfill({ status: path === '/api/auth/me' ? 401 : 200, contentType: 'application/json', body: JSON.stringify(bodies[path] ?? {}) })
  })
}

test.beforeEach(async ({ page }) => {
  // External requests are intercepted; no test data is sent to providers.
  await page.route(/^https:\/\//, route => route.abort())
})

for (const width of [1280, 1024, 768, 390, 320]) {
  test(`public documents, refresh, footer and navigation at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 })
    const errors: string[] = []
    const apis: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('request', request => { if (new URL(request.url()).pathname.startsWith('/api/')) apis.push(request.url()) })
    for (const document of legalDocuments) {
      expect((await page.goto(`/legal/${document.slug}`))?.status()).toBe(200)
      await expect(page.getByRole('heading', { level: 1, name: document.title, exact: true })).toBeVisible()
      await expect(page.getByLabel('Статус документів')).toContainText('не готові для публічного запуску')
      if (document.slug === 'about' && [1280, 390].includes(width)) await page.screenshot({ path: test.info().outputPath('about.png') })
      await page.reload()
      await expect(page.getByRole('heading', { level: 1, name: document.title, exact: true })).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
      const footer = page.getByRole('contentinfo')
      const lastLink = footer.getByRole('link', { name: 'Запити щодо персональних даних' })
      await lastLink.scrollIntoViewIfNeeded()
      await expect(lastLink).toBeVisible()
      if (document.slug === 'about' && [1280, 390].includes(width)) await page.screenshot({ path: test.info().outputPath('footer.png') })
      if (width < 768) {
        const nav = page.getByRole('navigation', { name: 'Основна навігація', exact: true })
        await expect(nav.getByRole('link')).toHaveCount(5)
        const linkBox = await lastLink.boundingBox()
        const navBox = await nav.boundingBox()
        expect(linkBox!.y + linkBox!.height).toBeLessThanOrEqual(navBox!.y)
      }
    }
    await page.goto('/legal/privacy#providers')
    await expect(page.locator('#providers')).toBeInViewport()
    await page.getByRole('contentinfo').getByRole('link', { name: 'Умови користування' }).click()
    await expect(page).toHaveURL(/\/legal\/terms$/)
    expect(apis).toEqual([])
    expect(errors).toEqual([])
  })
}

test('storage reset removes only disclosed preferences and works when storage is denied', async ({ page }) => {
  await page.goto('/legal/cookies')
  await page.evaluate(() => {
    localStorage.setItem('deshchotreba.home-city', '{"name":"Київ"}')
    localStorage.setItem('productDisplayCurrency', 'EUR')
    localStorage.setItem('notificationContext', 'buying')
    localStorage.setItem('deshchotreba.push.owner', 'keep-push')
    sessionStorage.setItem('discoverMapState', '{"private":"address"}')
    sessionStorage.setItem('seller-offer-draft:test', 'keep-draft')
  })
  await page.getByRole('button', { name: 'Очистити збережені налаштування пошуку' }).click()
  await expect(page.getByRole('status')).toContainText('очищено')
  expect(await page.evaluate(() => [localStorage.getItem('deshchotreba.home-city'), localStorage.getItem('productDisplayCurrency'), localStorage.getItem('notificationContext'), sessionStorage.getItem('discoverMapState')])).toEqual([null, null, null, null])
  expect(await page.evaluate(() => [localStorage.getItem('deshchotreba.push.owner'), sessionStorage.getItem('seller-offer-draft:test')])).toEqual(['keep-push', 'keep-draft'])
  await page.evaluate(() => { Storage.prototype.removeItem = () => { throw new DOMException('Blocked', 'SecurityError') } })
  await page.getByRole('button', { name: 'Очистити збережені налаштування пошуку' }).click()
  await expect(page.getByRole('status')).toContainText('Браузер не дозволив')
})

test('guest footer reaches documents and existing Help Center; IP lookup requires a button', async ({ page }) => {
  await fixtureApis(page)
  await page.addInitScript(() => localStorage.setItem('deshchotreba-onboarding-v1', 'done'))
  let ipRequests = 0
  await page.route('https://api.ipapi.is/**', async route => {
    ipRequests++
    await route.fulfill({ contentType: 'application/json', body: JSON.stringify({ location: { country_code: 'UA', city: 'Kyiv', latitude: 50.45, longitude: 30.52 } }) })
  })
  await page.goto('/')
  const ipButton = page.getByRole('button', { name: 'Визначити місто за IP через ipapi.is' })
  await expect(ipButton).toBeVisible()
  expect(ipRequests).toBe(0)
  await ipButton.click()
  await expect.poll(() => ipRequests).toBe(1)
  await expect(page.locator('.map-city-suggestion')).toContainText('Київ')
  await page.getByRole('contentinfo').getByRole('button', { name: 'Центр допомоги', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Центр допомоги', exact: true })).toBeVisible()
})

test('standalone footer Help Center entry opens the existing help panel', async ({ page }) => {
  await fixtureApis(page)
  await page.addInitScript(() => localStorage.setItem('deshchotreba-onboarding-v1', 'done'))
  await page.goto('/legal/about')
  await page.getByRole('contentinfo').getByRole('link', { name: 'Центр допомоги', exact: true }).click()
  await expect(page.getByRole('complementary', { name: 'Центр допомоги', exact: true })).toBeVisible()
})
