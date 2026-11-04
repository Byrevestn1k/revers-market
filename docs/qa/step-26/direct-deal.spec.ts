import { test, expect } from '@playwright/test'
import { mkdir } from 'node:fs/promises'

// Run only against the isolated Step 26 database and its local test servers.
if (process.env.DATABASE_URL !== 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test') throw new Error('Step 26 requires its isolated database')
test.setTimeout(300_000)

for (const width of [390, 1280]) test(`direct deal, ${width}px`, async ({ browser, request }) => {
    const suffix = `${Date.now()}${width}`
    const password = 'StrongPassword1'
    const buyerName = `s26b_${suffix}`, sellerName = `s26s_${suffix}`
    const buyerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width, height: 900 } })
    const sellerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width, height: 900 } })
    try {
        for (const [api, username, prefix] of [[buyerContext.request, buyerName, '50'], [sellerContext.request, sellerName, '67']] as const) {
            const result = await api.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${prefix}${suffix.slice(-7)}`, password, passwordConfirmation: password } })
            expect(result.status(), await result.text()).toBe(201)
        }
        const categories = (await (await request.get('http://127.0.0.1:33026/api/categories')).json()).categories
        const category = categories.find((item: { code: string }) => item.code === 'grains')
        const created = await sellerContext.request.post('/api/products', { data: { categoryId: category.id, title: `Тестовий товар Step 26 ${width}`, quantity: 10, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] } })
        expect(created.status(), await created.text()).toBe(201)
        const productId = (await created.json()).product.id
        const buyer = await buyerContext.newPage(), seller = await sellerContext.newPage()
        for (const [context, page, username] of [[buyerContext, buyer, buyerName], [sellerContext, seller, sellerName]] as const) {
            await context.request.post('/api/auth/logout')
            await page.goto('/auth/login')
            await page.locator('input[name="username"]').fill(username)
            await page.locator('input[name="password"]').fill(password)
            await page.getByRole('button', { name: 'Увійти в акаунт' }).click()
            await expect(page).not.toHaveURL(/\/auth\/login/, { timeout: 30_000 })
        }
        await mkdir('docs/qa/step-26/screenshots', { recursive: true })
        await buyer.goto(`/products/${productId}`)
        await buyer.getByRole('button', { name: 'Запропонувати угоду' }).click()
        const form = buyer.locator('form.offer-form')
        await expect(form).toBeVisible()
        await form.locator('input[name="quantity"]').fill('2')
        await expect(form).toContainText('USD')
        await form.getByRole('button', { name: 'Надіслати пропозицію' }).click()
        await expect(buyer.getByText('Пропозицію надіслано продавцю', { exact: false })).toBeVisible()
        await buyer.screenshot({ path: `docs/qa/step-26/screenshots/buyer-${width}.png`, fullPage: true })
        expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await seller.goto('/notifications')
        await seller.getByRole('tab', { name: /Я продавець/ }).click()
        const notification = seller.locator('.notification-row').filter({ hasText: 'Покупець запропонував угоду' }).first()
        await expect(notification).toBeVisible()
        await notification.getByRole('button', { name: 'Переглянути' }).click()
        await expect(seller).toHaveURL(/\/messages\/[^?]+\?proposal=/)
        await expect(seller.locator('.negotiation-card:focus')).toBeVisible()
        await seller.getByRole('button', { name: 'Прийняти умови' }).click()
        await expect(seller.getByText('Умови погоджено', { exact: false }).first()).toBeVisible()
        await seller.screenshot({ path: `docs/qa/step-26/screenshots/seller-${width}.png`, fullPage: true })
        expect(await seller.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
        await seller.goto('/orders')
        await seller.getByRole('button', { name: 'Підтверджую передачу товару' }).click()
        await seller.getByRole('dialog').getByRole('button', { name: 'Підтвердити', exact: true }).click({ clickCount: 2 })
        await expect(seller.getByText('Очікуємо покупця', { exact: false }).first()).toBeVisible()
        await expect(seller.getByRole('button', { name: 'Підтверджую передачу товару' })).toHaveCount(0)
        await buyer.goto('/orders')
        await buyer.getByRole('button', { name: 'Підтверджую отримання товару' }).click()
        await buyer.getByRole('dialog').getByRole('button', { name: 'Підтвердити', exact: true }).click()
        await expect(buyer.getByText('Угоду завершено', { exact: false }).first()).toBeVisible()
        for (const page of [buyer, seller]) {
            if (page === seller) await page.goto('/orders')
            await page.getByRole('button', { name: 'Залишити відгук', exact: true }).click()
            const review = page.locator('form[aria-label^="Відгук про"]')
            for (const select of await review.locator('select').all()) await select.selectOption('12')
            await review.locator('input[name="body"]').fill('Тестовий відгук')
            await review.getByRole('button', { name: 'Залишити відгук' }).click()
            await expect(page.getByText('Ваш відгук збережено.')).toBeVisible()
        }
        await buyer.screenshot({ path: `docs/qa/step-26/screenshots/completed-${width}.png`, fullPage: true })
        await buyer.goto(`/products/${productId}`)
        await expect(buyer.getByText('8 кг', { exact: false }).first()).toBeVisible()
    } finally { await buyerContext.close(); await sellerContext.close() }
})
