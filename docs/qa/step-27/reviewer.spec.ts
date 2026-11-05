import { expect, test } from '@playwright/test'
import { randomUUID } from 'node:crypto'

for (const width of [390, 1280]) test(`review correction: deleted deal chat and real menu position ${width}`, async ({ browser }) => {
    const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width, height: 844 } })
    const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width, height: 844 } })
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8)
    const register = async (ctx: typeof buyer, name: string) => {
        const r = await ctx.request.post('/api/auth/register', { data: { username: name, email: `${name}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
        expect(r.status()).toBe(201)
    }
    try {
        await register(buyer, `tester_b_${suffix}`); await register(seller, `tester_s_${suffix}`)
        const categories = (await (await buyer.request.get('/api/categories')).json()).categories
        const categoryId = categories.find((c: any) => c.code === 'grains').id
        const title = `Угода перевірка ${suffix}`
        const req = await buyer.request.post('/api/buy-requests', { data: { categoryId, title, description: '', delivery: 'no', minPrice: 0, maxPrice: 150, quantity: 10, unit: 'kg', currency: 'UAH', geoArea: 'Київська область', fulfillmentMode: 'multiple_sellers' } })
        expect(req.status()).toBe(201)
        const offer = await seller.request.post(`/api/buy-requests/${(await req.json()).buyRequest.id}/offers`, { data: { quantity: 10, unit: 'kg', price: 145, currency: 'UAH', delivery: 'Самовивіз' } })
        expect(offer.status()).toBe(201)
        const offerId = (await offer.json()).offer.id
        const deal = await buyer.request.post(`/api/offers/${offerId}/accept`, { data: { quantity: 5, selectionKey: randomUUID() } })
        expect(deal.status()).toBe(201)
        const orderId = (await deal.json()).order.id
        const chatId = (await (await buyer.request.get(`/api/orders/${orderId}/conversation`)).json()).conversation.id
        const old = `Стара історія ${suffix}`, fresh = `Нова історія ${suffix}`
        expect((await buyer.request.post(`/api/conversations/${chatId}/messages`, { data: { body: old } })).status()).toBe(201)
        if (width === 390) for (let i = 0; i < 6; i++) {
            const product = await seller.request.post('/api/products', { data: { categoryId, title: `Тест список ${suffix} ${i}`, quantity: 10, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] } })
            expect(product.status()).toBe(201)
            expect((await buyer.request.post(`/api/products/${(await product.json()).product.id}/conversation`)).ok()).toBeTruthy()
        }
        const page = await buyer.newPage()
        await page.goto('/messages')
        const row = page.locator('.conversation-row').filter({ hasText: title })
        await expect(row).toHaveCount(1)
        const trigger = row.getByRole('button', { name: 'Дії з чатом' })
        if (width === 390) {
            await trigger.evaluate(element => element.scrollIntoView({ block: 'end' }))
            await page.evaluate(() => window.scrollBy(0, 85))
            const buttonBox = await trigger.boundingBox(), navBox = await page.locator('.mobile-nav').boundingBox()
            expect(navBox!.y - (buttonBox!.y + buttonBox!.height)).toBeGreaterThanOrEqual(0)
            expect(navBox!.y - (buttonBox!.y + buttonBox!.height)).toBeLessThan(180)
        }
        await trigger.click()
        if (width === 390) {
            const menu = page.getByRole('menu'), box = await menu.boundingBox(), navBox = await page.locator('.mobile-nav').boundingBox()
            expect(box!.y).toBeGreaterThanOrEqual(0)
            expect(box!.x).toBeGreaterThanOrEqual(0)
            expect(box!.x + box!.width).toBeLessThanOrEqual(width)
            expect(box!.y + box!.height).toBeLessThanOrEqual(navBox!.y)
            for (const item of await menu.getByRole('menuitem').all()) await expect(item).toBeVisible()
            await page.screenshot({ path: 'docs/qa/step-27/reviewer-menu-real-390.png', fullPage: true })
        }
        await page.getByRole('menuitem', { name: 'Перемістити в кошик' }).click()
        await page.getByRole('button', { name: 'Перемістити', exact: true }).click()
        await page.getByRole('button', { name: 'Кошик', exact: true }).click()
        await page.locator('.conversation-row').filter({ hasText: title }).getByRole('button', { name: 'Дії з чатом' }).click()
        await page.getByRole('menuitem', { name: 'Видалити остаточно' }).click()
        await page.getByRole('button', { name: 'Видалити', exact: true }).click()
        await expect.poll(async () => (await buyer.request.get(`/api/conversations/${chatId}/messages`)).status()).toBe(404)
        expect((await seller.request.post(`/api/conversations/${chatId}/messages`, { data: { body: fresh } })).status()).toBe(201)
        expect((await (await buyer.request.get('/api/conversations')).json()).conversations.find((c: any) => c.id === chatId).unreadCount).toBeGreaterThan(0)
        await page.goto(`/messages/${chatId}`)
        await expect(page.locator('.deal-chat-history')).toContainText(fresh)
        await expect(page.locator('.deal-chat-history')).not.toContainText(old)
        await expect.poll(async () => (await (await buyer.request.get('/api/conversations')).json()).conversations.find((c: any) => c.id === chatId).unreadCount).toBe(0)
        await page.screenshot({ path: `docs/qa/step-27/reviewer-deal-${width}.png`, fullPage: true })
        await page.goto('/orders')
        await expect(page.getByRole('button', { name: 'Написати продавцю' })).toBeVisible()
        await page.getByRole('button', { name: 'Написати продавцю' }).click()
        await expect(page).toHaveURL(new RegExp(`/messages/${chatId}`))
    } finally { await buyer.close(); await seller.close() }
})
