import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('public profile displays both role ratings at six widths', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5181' })
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
    const username = `tester_rating_${suffix}`
    const result = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
    expect(result.status()).toBe(201)
    const page = await context.newPage()
    await page.goto(`/profiles/${username}`)
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(page.getByText('★ Продавець (0)')).toBeVisible()
        await expect(page.getByText('★ Покупець (0)')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
        await page.screenshot({ path: `docs/qa/step-29/profile-${width}.png`, fullPage: true })
    }
    await context.close()
})

test('Product and Buy Request use the relevant participant rating', async ({ browser }) => {
    const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5181', viewport: { width: 390, height: 900 } })
    const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5181', viewport: { width: 390, height: 900 } })
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8)
    for (const [context, role] of [[buyer, 'b'], [seller, 's']] as const) {
        const username = `tester_${role}_${suffix}`
        const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
        expect(response.status()).toBe(201)
    }
    const categories = (await (await buyer.request.get('/api/categories')).json()).categories
    const categoryId = categories.find((item: any) => item.code === 'grains').id
    const product = await seller.request.post('/api/products', { data: { categoryId, title: `Тестовий товар ${suffix}`, description: '', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київська область', status: 'active' } })
    expect(product.status()).toBe(201)
    const productId = (await product.json()).product.id
    const request = await buyer.request.post('/api/buy-requests', { data: { categoryId, title: `Тестовий запит ${suffix}`, description: '', delivery: 'no', minPrice: 0, maxPrice: 150, quantity: 10, unit: 'kg', currency: 'UAH', geoArea: 'Київська область', fulfillmentMode: 'multiple_sellers' } })
    expect(request.status()).toBe(201)
    const requestId = (await request.json()).buyRequest.id
    const page = await buyer.newPage()
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/products/${productId}`)
        await expect(page.locator('.listing-person-card')).toContainText('Продавець')
        await expect(page.locator('.listing-person-card')).toContainText('0 відгуків')
        await page.screenshot({ path: `docs/qa/step-29/product-${width}.png`, fullPage: true })
        await page.goto(`/buy-requests/${requestId}`)
        await expect(page.locator('.listing-person-card')).toContainText('Покупець')
        await expect(page.locator('.listing-person-card')).toContainText('0 відгуків')
        await page.screenshot({ path: `docs/qa/step-29/request-${width}.png`, fullPage: true })
    }
    const offerResponse = await seller.request.post(`/api/buy-requests/${requestId}/offers`, { data: { requestKey: randomUUID(), quantity: 10, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' } })
    expect(offerResponse.status()).toBe(201)
    const offer = (await offerResponse.json()).offer
    const accepted = await buyer.request.post(`/api/offers/${offer.id}/accept`, { data: { expectedRevision: offer.revision, quantity: 10, selectionKey: randomUUID() } })
    expect(accepted.status()).toBe(201)
    const orderId = (await accepted.json()).order.id
    expect((await seller.request.post(`/api/orders/${orderId}/seller-confirm`)).status()).toBe(200)
    expect((await buyer.request.post(`/api/orders/${orderId}/complete`, { data: { actualQuantity: 10 } })).status()).toBe(200)
    expect((await seller.request.post(`/api/orders/${orderId}/complete`)).status()).toBe(200)
    for (const [context, rating, role] of [[buyer, '12', 'продавця'], [seller, '7', 'покупця']] as const) {
        const reviewPage = await context.newPage()
        await reviewPage.setViewportSize({ width: 1280, height: 900 })
        await reviewPage.goto('/')
        await reviewPage.getByRole('button', { name: /Мої угоди/ }).first().click()
        const card = reviewPage.locator(`#order-${orderId}`)
        await card.getByRole('button', { name: 'Залишити відгук' }).click()
        const form = card.getByRole('form', { name: new RegExp(`Відгук про ${role}`) })
        await form.locator('[name=rating]').selectOption(rating)
        await form.locator('[name=communicationRating]').selectOption(rating)
        await form.locator('[name=complianceRating]').selectOption(rating)
        if (role === 'продавця') await form.locator('[name=descriptionRating]').selectOption(rating)
        await reviewPage.screenshot({ path: `docs/qa/step-29/review-${role}.png`, fullPage: true })
        await form.getByRole('button', { name: 'Залишити відгук' }).click()
        await expect(card.getByText('Ваш відгук збережено.')).toBeVisible()
        await reviewPage.close()
    }
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/products/${productId}`)
        await expect(page.locator('.listing-person-card')).toContainText('★ 12 · 1 відгуків')
        await page.screenshot({ path: `docs/qa/step-29/product-rated-${width}.png`, fullPage: true })
        await page.goto(`/buy-requests/${requestId}`)
        await expect(page.locator('.listing-person-card')).toContainText('★ 7 · 1 відгуків')
        await page.screenshot({ path: `docs/qa/step-29/request-rated-${width}.png`, fullPage: true })
    }
    await buyer.close()
    await seller.close()
})
