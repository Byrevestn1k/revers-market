import { expect, test, type BrowserContext } from '@playwright/test'
import { Client } from 'pg'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const photo = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
const brokenUrl = 'https://127.0.0.1:1/unavailable-photo.png'

test('seller draft warning and unavailable offer photos in the real UI', async ({ browser }) => {
  test.setTimeout(180_000)
  const suffix = Date.now().toString(36)
  const contexts: BrowserContext[] = []
  const userIds: string[] = []
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  try {
    for (const [index, role] of ['buyer', 'seller'].entries()) {
      const context = await browser.newContext({ viewport: { width: 1440, height: 900 } })
      contexts.push(context)
      const username = `step13fix_${role}_${suffix}`
      const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${String(Date.now()).slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
      expect(registered.status()).toBe(201)
      userIds.push((await registered.json()).user.id)
      expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200)
      expect((await context.request.get('/api/auth/me')).status()).toBe(200)
    }
    const [buyerContext, sellerContext] = contexts
    const categories = (await (await buyerContext.request.get('/api/categories')).json()).categories
    const category = categories.find((item: { code: string }) => item.code === 'grains')
    const requestResponse = await buyerContext.request.post('/api/buy-requests', { data: { categoryId: category.id, title: `Фото запит ${suffix}`, description: 'Потрібен товар', quantity: 2, unit: 'kg', currency: 'UAH', receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' } })
    expect(requestResponse.status(), await requestResponse.text()).toBe(201)
    const requestId = (await requestResponse.json()).buyRequest.id as string
    const productResponse = await sellerContext.request.post('/api/products', { data: { categoryId: category.id, title: `Товар ${suffix}`, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [{ url: brokenUrl }, { dataUrl: `data:image/png;base64,${photo.toString('base64')}` }] } })
    expect(productResponse.status(), await productResponse.text()).toBe(201)
    const product = (await productResponse.json()).product
    await sellerContext.addInitScript(() => {
      const original = Storage.prototype.setItem
      Storage.prototype.setItem = function (key, value) {
        if (key.startsWith('seller-offer-draft:') && value.includes('data:image/')) throw new DOMException('Full', 'QuotaExceededError')
        return original.call(this, key, value)
      }
    })
    const seller = await sellerContext.newPage()
    await seller.goto(`/buy-requests/${requestId}`)
    await expect(seller.locator('.seller-badge')).toBeVisible()
    await seller.getByRole('button', { name: 'Запропонувати товар' }).click()
    let form = seller.locator('form.seller-offer-form')
    await form.getByLabel('Вручну').check()
    await form.getByLabel('Додати фотографії').setInputFiles({ name: 'draft.png', mimeType: 'image/png', buffer: photo })
    await expect(form.locator('.photo-picker-item')).toHaveCount(1)
    await expect(form.getByRole('alert')).toContainText('не збереглися в чернетці')
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await seller.setViewportSize({ width, height: 900 })
      const overflow = await seller.evaluate(() => ({ width: innerWidth, scroll: document.documentElement.scrollWidth, elements: Array.from(document.querySelectorAll('*')).filter(element => element.getBoundingClientRect().right > innerWidth + 1).slice(0, 8).map(element => `${element.tagName}.${element.className}: ${Math.round(element.getBoundingClientRect().right)}`) }))
      expect(overflow.scroll <= width, `draft form overflow at ${width}: ${JSON.stringify(overflow)}`).toBe(true)
    }
    await seller.goto('/requests')
    await seller.goBack()
    await seller.getByRole('button', { name: 'Запропонувати товар' }).click()
    form = seller.locator('form.seller-offer-form')
    await expect(form.getByRole('alert')).toContainText('Додайте їх знову')
    await expect(form.locator('.photo-picker-item')).toHaveCount(0)
    await form.getByLabel('Свій товар').check()
    await form.getByLabel('Мій активний товар').selectOption(product.id)
    await expect(form.getByText('Фото недоступне')).toBeVisible()
    await expect(form.getByRole('button', { name: 'Видалити фото 1' })).toBeVisible()

    const offerResponse = await sellerContext.request.post(`/api/buy-requests/${requestId}/offers`, { data: { creationMode: 'product', productId: product.id, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз', photos: product.photos.map((item: { url: string }) => ({ url: item.url })) } })
    expect(offerResponse.status(), await offerResponse.text()).toBe(201)
    const buyer = await buyerContext.newPage()
    await buyer.goto(`/buy-requests/${requestId}`)
    await expect(buyer.locator('.seller-badge')).toBeVisible()
    const card = buyer.locator('article.deal-offer')
    await expect(card.locator('.category-image.deal-offer-photo')).toBeVisible()
    await card.getByText('Детальніше та інші дії').click()
    await expect(card.locator('.seller-offer-gallery .category-image.seller-offer-main-image')).toBeVisible()
    await card.getByRole('button', { name: 'Показати фото 2' }).click()
    await expect(card.locator('img.seller-offer-main-image')).toBeVisible()
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyer.setViewportSize({ width, height: 900 })
      expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `offer gallery overflow at ${width}`).toBe(true)
    }
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()))
    if (userIds.length) {
      await db.connect()
      try {
        const offerFiles = (await db.query('SELECT storage_key FROM offer_photos WHERE offer_id IN (SELECT id FROM offers WHERE seller_id = ANY($1::uuid[]))', [userIds])).rows.map(row => row.storage_key as string)
        const productFiles = (await db.query('SELECT storage_key FROM product_photos WHERE product_id IN (SELECT id FROM products WHERE owner_id = ANY($1::uuid[]))', [userIds])).rows.map(row => row.storage_key as string)
        await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
        for (const [kind, files] of [['offers', offerFiles], ['products', productFiles]] as const) for (const key of files) if (key.includes('.') && !key.includes('..')) await unlink(join('backend/uploads', kind, key)).catch(() => undefined)
      } finally { await db.end() }
    }
  }
})
