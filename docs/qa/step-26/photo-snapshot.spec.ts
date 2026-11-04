import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir, unlink } from 'node:fs/promises'
import { resolve } from 'node:path'
import sharp from 'sharp'

if (process.env.DATABASE_URL !== 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test') throw new Error('Step 26 requires its isolated database')
test.setTimeout(180_000)

test('historical product photo remains visible in the deal', async ({ browser, request }) => {
  const suffix = String(Date.now()), password = 'StrongPassword1'
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width: 1280, height: 900 } })
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5179' })
  let uploadedFile: string | null = null
  try {
    for (const [context, prefix] of [[buyer, '50'], [seller, '67']] as const) {
      const username = `s26photo_${prefix}_${suffix}`
      const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${prefix}${suffix.slice(-7)}`, password, passwordConfirmation: password } })
      expect(registered.status(), await registered.text()).toBe(201)
    }
    const categories = (await (await request.get('http://127.0.0.1:33026/api/categories')).json()).categories
    const category = categories.find((item: { code: string }) => item.code === 'grains')
    const photo = await sharp({ create: { width: 120, height: 100, channels: 3, background: '#34804b' } }).png().toBuffer()
    const product = await seller.request.post('/api/products', { data: { categoryId: category.id, title: 'Тест історичного фото', quantity: 10, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [{ dataUrl: `data:image/png;base64,${photo.toString('base64')}`, alt: 'Тестове фото' }] } })
    expect(product.status(), await product.text()).toBe(201)
    const data = (await product.json()).product, photoUrl: string = data.photos[0].url
    const match = /^\/uploads\/products\/([0-9a-f-]{36})(?:\/([0-9a-f-]{36}))?\/(\d+\.png)$/i.exec(photoUrl)
    expect(match).not.toBeNull()
    uploadedFile = resolve('backend/uploads/products', match![1], ...(match![2] ? [match![2]] : []), match![3])
    const chat = await buyer.request.post(`/api/products/${data.id}/conversation`, { data: {} })
    const chatId = (await chat.json()).conversation.id, path = `/api/conversations/${chatId}/direct-proposals`
    const context = (await (await buyer.request.get(path)).json()).context
    const proposed = await buyer.request.post(path, { data: { action: 'propose', requestKey: randomUUID(), parentId: null, expectedTermsToken: context.termsToken, expectedCurrency: context.currency, expectedUnit: context.unit, expectedProductPrice: context.price, expectedDeliveryOptions: context.deliveryOptions, price: 100, quantity: 2, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0 } })
    const proposal = (await proposed.json()).proposal
    const accepted = await seller.request.post(path, { data: { action: 'accept', proposalId: proposal.id } })
    expect(accepted.status(), await accepted.text()).toBe(200)
    expect((await seller.request.patch(`/api/products/${data.id}`, { data: { photos: [] } })).status()).toBe(200)
    const page = await buyer.newPage()
    await page.goto('/orders')
    const card = page.locator('.order-card').filter({ hasText: 'Тест історичного фото' })
    const image = card.locator('img.order-product-image')
    await expect(image).toBeVisible({ timeout: 30_000 })
    await expect(image).toHaveAttribute('src', new RegExp(photoUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBeGreaterThan(0)
    await mkdir('docs/qa/step-26/screenshots', { recursive: true })
    await page.screenshot({ path: 'docs/qa/step-26/screenshots/photo-snapshot-1280.png', fullPage: true })
  } finally {
    await buyer.close(); await seller.close()
    if (uploadedFile) await unlink(uploadedFile).catch(() => undefined)
  }
})
