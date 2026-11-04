import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

if (process.env.DATABASE_URL !== 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test') throw new Error('Step 26 requires its isolated database')
test.setTimeout(180_000)

test('direct proposal form at additional widths', async ({ browser, request }) => {
  const suffix = String(Date.now()), password = 'StrongPassword1'
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5179' })
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5179' })
  try {
    for (const [context, prefix] of [[buyer, '50'], [seller, '67']] as const) {
      const username = `s26_${prefix}_${suffix}`
      const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${prefix}${suffix.slice(-7)}`, password, passwordConfirmation: password } })
      expect(response.status(), await response.text()).toBe(201)
    }
    const categories = (await (await request.get('http://127.0.0.1:33026/api/categories')).json()).categories
    const category = categories.find((item: { code: string }) => item.code === 'grains')
    const created = await seller.request.post('/api/products', { data: { categoryId: category.id, title: 'Тестовий товар', quantity: 10, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] } })
    expect(created.status(), await created.text()).toBe(201)
    const productId = (await created.json()).product.id
    const page = await buyer.newPage()
    await mkdir('docs/qa/step-26/screenshots', { recursive: true })
    await page.setViewportSize({ width: 320, height: 900 })
    await page.goto(`/products/${productId}`)
    await expect(page.getByRole('button', { name: 'Профіль' })).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Запропонувати угоду' }).click()
    const form = page.locator('form.offer-form')
    await expect(form.getByRole('button', { name: 'Надіслати пропозицію' })).toBeVisible({ timeout: 30_000 })
    for (const width of [320, 768, 1024, 1440]) {
      await page.setViewportSize({ width, height: 900 })
      const overflow = await page.evaluate(() => Array.from(document.querySelectorAll('*')).map(element => ({ tag: element.tagName, className: element.className, right: element.getBoundingClientRect().right, left: element.getBoundingClientRect().left })).filter(item => item.right > innerWidth + 1 || item.left < -1))
      expect(overflow, JSON.stringify(overflow)).toEqual([])
      const dimensions = await page.evaluate(() => ({ width: innerWidth, document: document.documentElement.scrollWidth, offenders: Array.from(document.querySelectorAll('*')).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => ({ tag: element.tagName, className: element.className, width: element.clientWidth, scroll: element.scrollWidth })) }))
      expect(dimensions.document, JSON.stringify(dimensions)).toBeLessThanOrEqual(width)
      for (const control of await form.locator('input, select, textarea, button').all()) {
        const box = await control.boundingBox()
        expect(box && box.x >= 0 && box.x + box.width <= width + 1).toBeTruthy()
      }
      await page.screenshot({ path: `docs/qa/step-26/screenshots/form-${width}.png`, fullPage: true })
    }
  } finally { await buyer.close(); await seller.close() }
})
