import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'

test('public profile displays both role ratings at six widths', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5181' })
    const suffix = randomUUID().replaceAll('-', '').slice(0, 10)
    const username = `tester_rating_${suffix}`
    const result = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
    expect(result.status()).toBe(201)
    const longName = 'LongProfileName'.repeat(3)
    expect((await context.request.patch('/api/profile/me', { data: { nickname: longName } })).status()).toBe(200)
    const page = await context.newPage()
    await page.goto(`/profiles/${username}`)
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        await expect(page.getByText('★ Продавець (0)')).toBeVisible()
        await expect(page.getByText('★ Покупець (0)')).toBeVisible()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
        const title = page.locator('.public-profile-title h1')
        await expect(title).toHaveText(longName)
        expect(await title.evaluate(element => element.scrollWidth <= element.clientWidth)).toBeTruthy()
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
    await page.goto(`/buy-requests/${requestId}`)
    await page.getByRole('button', { name: 'Написати продавцю' }).first().click()
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        const emptyRating = page.getByTestId('open-chat-header').getByTestId('chat-counterpart')
        await expect(emptyRating).toContainText('Продавець · Ще немає відгуків')
        await expect(emptyRating).not.toContainText('0/12')
        await page.screenshot({ path: `docs/qa/step-29/chat-no-reviews-${width}.png`, fullPage: true })
    }
    const accepted = await buyer.request.post(`/api/offers/${offer.id}/accept`, { data: { expectedRevision: offer.revision, quantity: 10, selectionKey: randomUUID() } })
    expect(accepted.status()).toBe(201)
    const orderId = (await accepted.json()).order.id
    expect((await seller.request.post(`/api/orders/${orderId}/seller-confirm`)).status()).toBe(200)
    expect((await buyer.request.post(`/api/orders/${orderId}/complete`, { data: { actualQuantity: 10 } })).status()).toBe(200)
    expect((await seller.request.post(`/api/orders/${orderId}/complete`)).status()).toBe(200)
    for (const [context, rating, role] of [[buyer, '12', 'продавця'], [seller, '7', 'покупця']] as const) {
        const reviewPage = await context.newPage()
        await reviewPage.setViewportSize({ width: 390, height: 900 })
        await reviewPage.goto(`/orders?order=${orderId}`)
        const card = reviewPage.locator(`#order-${orderId}`)
        await card.getByRole('button', { name: 'Залишити відгук' }).click()
        const form = card.getByRole('form', { name: new RegExp(`Відгук про ${role}`) })
        await form.locator('[name=rating]').selectOption(rating)
        await form.locator('[name=communicationRating]').selectOption(rating)
        await form.locator('[name=complianceRating]').selectOption(rating)
        if (role === 'продавця') await form.locator('[name=descriptionRating]').selectOption(rating)
        await reviewPage.screenshot({ path: `docs/qa/step-29/review-390-${role}.png`, fullPage: true })
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
    const ownPage = await seller.newPage()
    await ownPage.goto('/settings/profile')
    await expect(ownPage.locator('.profile-rating')).toContainText('12/12')
    await expect(ownPage.locator('.profile-rating')).toContainText('Покупець')
    await ownPage.screenshot({ path: 'docs/qa/step-29/own-profile-390.png', fullPage: true })
    const nextRequest = await buyer.request.post('/api/buy-requests', { data: { categoryId, title: `Next request ${suffix}`, description: '', delivery: 'no', minPrice: 0, maxPrice: 150, quantity: 2, unit: 'kg', currency: 'UAH', geoArea: 'Київська область', fulfillmentMode: 'multiple_sellers' } })
    expect(nextRequest.status()).toBe(201)
    const nextId = (await nextRequest.json()).buyRequest.id
    const nextOffer = await seller.request.post(`/api/buy-requests/${nextId}/offers`, { data: { requestKey: randomUUID(), creationMode: 'manual', title: 'Seller rating check', quantity: 2, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' } })
    expect(nextOffer.status()).toBe(201)
    for (const width of [390, 1280]) {
        await page.setViewportSize({ width, height: 900 })
        await page.goto(`/buy-requests/${nextId}`)
        await expect(page.locator('.deal-offer')).toContainText('★ 12/12')
        await page.screenshot({ path: `docs/qa/step-29/offer-rating-${width}.png`, fullPage: true })
    }
    await page.getByRole('button', { name: 'Написати продавцю' }).first().click()
    await expect(page).toHaveURL(/\/messages\//)
    const sellerChat = await seller.newPage()
    await sellerChat.goto(page.url())
    for (const width of [390, 1280]) {
        for (const [chatPage, username, role, expected, wrong] of [[page, `tester_s_${suffix}`, 'Продавець', '12/12', '7/12'], [sellerChat, `tester_b_${suffix}`, 'Покупець', '7/12', '12/12']] as const) {
            await chatPage.setViewportSize({ width, height: 900 })
            const header = chatPage.getByTestId('open-chat-header')
            const counterpart = header.getByTestId('chat-counterpart')
            await expect(counterpart).toBeVisible({ timeout: 20000 })
            await expect(counterpart).toContainText(username)
            await expect(counterpart).toContainText(`${role} · ${expected}`)
            await expect(counterpart).not.toContainText(wrong)
            expect(await counterpart.evaluate(element => element.scrollWidth <= element.clientWidth && element.scrollHeight <= element.clientHeight)).toBeTruthy()
            await chatPage.screenshot({ path: `docs/qa/step-29/chat-${role}-${width}.png`, fullPage: true })
        }
    }
    const productChat = await buyer.request.post(`/api/products/${productId}/conversation`)
    const requestChat = await seller.request.post(`/api/buy-requests/${nextId}/conversation`)
    const dealChat = await buyer.request.get(`/api/orders/${orderId}/conversation`)
    for (const response of [productChat, requestChat, dealChat]) expect([200, 201]).toContain(response.status())
    const contextChats = [
        ['product', (await productChat.json()).conversation.id],
        ['request', (await requestChat.json()).conversation.id],
        ['deal', (await dealChat.json()).conversation.id],
    ] as const
    for (const [kind, conversationId] of contextChats) {
        for (const [chatPage, username, role, expected] of [[page, `tester_s_${suffix}`, 'Продавець', '12/12'], [sellerChat, `tester_b_${suffix}`, 'Покупець', '7/12']] as const) {
            await chatPage.goto(`/messages/${conversationId}`)
            const counterpart = chatPage.getByTestId('open-chat-header').getByTestId('chat-counterpart')
            await expect(counterpart, `context ${kind}, ${role}`).toBeVisible({ timeout: 20000 })
            await expect(counterpart).toContainText(username)
            await expect(counterpart).toContainText(`${role} · ${expected}`)
            await chatPage.screenshot({ path: `docs/qa/step-29/chat-${kind}-${role}.png`, fullPage: true })
        }
    }
    const sellerId = (await (await buyer.request.get(`/api/profiles/tester_s_${suffix}`)).json()).profile.id
    const direct = await buyer.request.post(`/api/users/${sellerId}/conversation`)
    expect(direct.status()).toBe(201)
    const directId = (await direct.json()).conversation.id
    for (const directPage of [page, sellerChat]) {
        await directPage.goto(`/messages/${directId}`)
        for (const width of [390, 1280]) {
            await directPage.setViewportSize({ width, height: 900 })
            const counterpart = directPage.getByTestId('open-chat-header').getByTestId('chat-counterpart')
            await expect(counterpart).toHaveText('Прямий чат', { timeout: 20000 })
            await expect(counterpart).not.toContainText(/Продавець|Покупець|\/12/)
            await directPage.screenshot({ path: `docs/qa/step-29/chat-direct-${directPage === page ? 'buyer' : 'seller'}-${width}.png`, fullPage: true })
        }
    }
    await sellerChat.close()
    await ownPage.close()
    await buyer.close()
    await seller.close()
})

test('profile works with an older API response without embedded reviews', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5181', viewport: { width: 390, height: 900 } })
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8)
    const username = `tester_legacy_${suffix}`
    const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
    expect(response.status()).toBe(201)
    const page = await context.newPage()
    await page.route(`**/api/profiles/${username}?includeReviews=1`, async route => {
        const upstream = await route.fetch()
        const data = await upstream.json()
        delete data.reviews
        await route.fulfill({ response: upstream, json: data })
    })
    await page.goto(`/profiles/${username}`)
    await expect(page.getByRole('heading', { name: username })).toBeVisible()
    await page.getByRole('tab', { name: /Відгуки/ }).click()
    await expect(page.getByText('Відгуків поки немає')).toBeVisible()
    await context.close()
})
