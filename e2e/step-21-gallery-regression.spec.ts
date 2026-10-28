import { test, expect } from '@playwright/test'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test('Step 21: saved ordering and gallery after thumbnail loading change', async ({ browser, baseURL }) => {
  test.setTimeout(300_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password || !process.env.DATABASE_URL) throw new Error('Local QA account or database unavailable')
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 850 } })
  const suffix = Date.now()
  const requestTitle = `Step21 gallery request ${suffix}`
  const files: string[] = []
  let productId = '', requestId = ''
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200)
    const category = ((await (await context.request.get('/api/categories')).json()).categories as { id: string; code: string }[]).find(item => item.code === 'grains')!
    const images = await Promise.all(['#2040a0', '#ab6130', '#40aa50'].map(async background => `data:image/png;base64,${(await sharp({ create: { width: 300, height: 180, channels: 3, background } }).png().toBuffer()).toString('base64')}`))
    const photos = images.map(dataUrl => ({ dataUrl }))
    const p = await context.request.post('/api/products', { data: { categoryId: category.id, title: `Step21 gallery product ${suffix}`, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos } })
    expect(p.status(), await p.text()).toBe(201)
    const product = (await p.json()).product; productId = product.id; files.push(...product.photos.map((photo: { url: string }) => photo.url))
    const r = await context.request.post('/api/buy-requests', { data: { categoryId: category.id, title: requestTitle, description: '', quantity: 2, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller', photos } })
    expect(r.status(), await r.text()).toBe(201)
    const buyRequest = (await r.json()).buyRequest; requestId = buyRequest.id; files.push(...buyRequest.photos.map((photo: { url: string }) => photo.url))
    const page = await context.newPage()
    page.setDefaultTimeout(30_000)
    await page.goto(`/my/products/${productId}/edit`, { waitUntil: 'domcontentloaded' })
    const productPicker = page.locator('.photo-picker')
    await expect(productPicker.locator('.photo-picker-item')).toHaveCount(3)
    await productPicker.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
    const productPatch = page.waitForResponse(response => new URL(response.url()).pathname === `/api/products/${productId}` && response.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Зберегти зміни' }).click()
    expect((await productPatch).status()).toBe(200)
    expect((await (await context.request.get(`/api/products/${productId}`)).json()).product.photos.map((photo: { url: string }) => photo.url)).toEqual([product.photos[1].url, product.photos[0].url, product.photos[2].url])
    await page.goto(`/my/products/${productId}/edit`, { waitUntil: 'domcontentloaded' }); await page.reload({ waitUntil: 'domcontentloaded' })
    await expect.poll(async () => (await page.locator('.photo-picker-item img').first().getAttribute('src'))?.endsWith(product.photos[1].url)).toBe(true)
    await page.goto('/my/requests', { waitUntil: 'domcontentloaded' })
    await page.locator('.buy-request-card').filter({ hasText: requestTitle }).getByRole('button', { name: 'Редагувати' }).click()
    let dialog = page.getByRole('dialog', { name: 'Редагувати запит' })
    await expect(dialog.locator('.photo-picker-item')).toHaveCount(3)
    await dialog.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
    const requestPatch = page.waitForResponse(response => new URL(response.url()).pathname === `/api/buy-requests/${requestId}` && response.request().method() === 'PATCH')
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    expect((await requestPatch).status()).toBe(200)
    expect((await (await context.request.get(`/api/buy-requests/${requestId}`)).json()).buyRequest.photos.map((photo: { url: string }) => photo.url)).toEqual([buyRequest.photos[1].url, buyRequest.photos[0].url, buyRequest.photos[2].url])
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.locator('.buy-request-card').filter({ hasText: requestTitle }).getByRole('button', { name: 'Редагувати' }).click()
    dialog = page.getByRole('dialog', { name: 'Редагувати запит' })
    await expect.poll(async () => (await dialog.locator('.photo-picker-item img').first().getAttribute('src'))?.endsWith(buyRequest.photos[1].url)).toBe(true)
    await dialog.getByRole('button', { name: 'Скасувати' }).click()
    for (const [path, label] of [[`/products/${productId}`, 'product'], [`/buy-requests/${requestId}`, 'request']] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      const gallery = page.locator('.request-gallery')
      await expect(gallery.locator('.request-gallery-main')).toBeVisible()
      await expect(gallery.locator('.request-gallery-thumbs button')).toHaveCount(3)
      await gallery.getByRole('button', { name: 'Наступне фото' }).first().click()
      await expect(gallery.locator('.gallery-controls').first()).toContainText('2 / 3')
      await gallery.getByRole('button', { name: 'Попереднє фото' }).first().click()
      await expect(gallery.locator('.gallery-controls').first()).toContainText('1 / 3')
      await gallery.getByRole('button', { name: 'Показати фото 3' }).click()
      await expect(gallery.locator('.gallery-controls').first()).toContainText('3 / 3')
      await gallery.getByRole('button', { name: 'Збільшити фото' }).click()
      await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toBeVisible()
      await page.screenshot({ path: `docs/step-21-evidence/${label}-gallery-final-390.png`, fullPage: true })
      await page.getByRole('dialog', { name: 'Перегляд фотографій' }).getByRole('button', { name: 'Закрити' }).click()
      await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toHaveCount(0)
      await gallery.getByRole('button', { name: 'Збільшити фото' }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toHaveCount(0)
      await gallery.locator('.gallery-open').scrollIntoViewIfNeeded()
      const box = (await gallery.locator('.gallery-open').boundingBox())!
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.2, y: box.y + box.height / 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.8, y: box.y + box.height / 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(gallery.locator('.gallery-controls').first()).toContainText('2 / 3')
      await cdp.detach()
    }
  } finally {
    await context.close()
    const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect()
    try {
      if (productId) await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [productId, username])
      if (requestId) await db.query('DELETE FROM buy_requests WHERE id=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [requestId, username])
    } finally { await db.end() }
    for (const url of files) if (/^\/uploads\/(products|buy-requests)\/[0-9a-f-]+(?:\/[0-9a-f-]+)?\/\d+\.(png|jpg|webp|gif)$/i.test(url)) await unlink(join('backend', url.slice(1))).catch(() => undefined)
  }
})
