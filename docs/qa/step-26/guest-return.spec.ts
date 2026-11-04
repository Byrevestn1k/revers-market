import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

if (process.env.DATABASE_URL !== 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test') throw new Error('Step 26 requires its isolated database')
test.setTimeout(180_000)

test('guest returns to the same product after login', async ({ browser, request }) => {
  const suffix = String(Date.now()), password = 'StrongPassword1', buyerName = `s26guest_${suffix}`
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width: 390, height: 900 } })
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5179' })
  try {
    for (const [context, username, prefix] of [[buyer, buyerName, '50'], [seller, `s26seller_${suffix}`, '67']] as const) {
      const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${prefix}${suffix.slice(-7)}`, password, passwordConfirmation: password } })
      expect(registered.status(), await registered.text()).toBe(201)
    }
    const categories = (await (await request.get('http://127.0.0.1:33026/api/categories')).json()).categories
    const category = categories.find((item: { code: string }) => item.code === 'grains')
    const created = await seller.request.post('/api/products', { data: { categoryId: category.id, title: 'Товар для входу гостя', quantity: 10, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] } })
    expect(created.status(), await created.text()).toBe(201)
    const productId = (await created.json()).product.id
    await buyer.request.post('/api/auth/logout')
    const page = await buyer.newPage()
    await page.goto(`/products/${productId}`)
    await page.getByRole('button', { name: 'Запропонувати угоду' }).click()
    await expect(page).toHaveURL(/\/auth\/login/, { timeout: 30_000 })
    await page.locator('input[name="username"]').fill(buyerName)
    await page.locator('input[name="password"]').fill(password)
    await page.getByRole('button', { name: 'Увійти в акаунт' }).click()
    await expect(page).toHaveURL(new RegExp(`/products/${productId}`), { timeout: 30_000 })
    await expect(page.locator('.direct-proposal-form')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Товар для входу гостя' })).toBeVisible()
    await mkdir('docs/qa/step-26/screenshots', { recursive: true })
    await page.screenshot({ path: 'docs/qa/step-26/screenshots/guest-return-390.png', fullPage: true })
  } finally { await buyer.close(); await seller.close() }
})
