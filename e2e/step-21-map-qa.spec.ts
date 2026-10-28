import { test, expect } from '@playwright/test'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test('Step 21: map cards, markers and Favorites with ordered photos', async ({ browser, baseURL }) => {
  test.setTimeout(300_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const credentials = (section: string) => {
    const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0]
    return { username: block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim(), password: block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim() }
  }
  const ownerCredentials = credentials('Hybrid'), viewerCredentials = credentials('Buyer A')
  if (!ownerCredentials.username || !ownerCredentials.password || !viewerCredentials.username || !viewerCredentials.password || !process.env.DATABASE_URL) throw new Error('Local QA accounts or database unavailable')
  const owner = await browser.newContext({ baseURL })
  const viewer = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
  const suffix = `${Date.now()}`
  const productTitle = `Step21 map product ${suffix}`
  const requestTitle = `Step21 map request ${suffix}`
  const files: string[] = []
  let productId = '', requestId = ''
  try {
    expect((await owner.request.post('/api/auth/login', { data: ownerCredentials })).status()).toBe(200)
    expect((await viewer.request.post('/api/auth/login', { data: viewerCredentials })).status()).toBe(200)
    const category = ((await (await owner.request.get('/api/categories')).json()).categories as { id: string; code: string }[]).find(item => item.code === 'grains')!
    const images = await Promise.all(['#1424c0', '#b05e30'].map(async background => `data:image/png;base64,${(await sharp({ create: { width: 240, height: 160, channels: 3, background } }).png().toBuffer()).toString('base64')}`))
    const common = { categoryId: category.id, settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', photos: images.map(dataUrl => ({ dataUrl })) }
    const productResponse = await owner.request.post('/api/products', { data: { ...common, title: productTitle, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active' } })
    expect(productResponse.status(), await productResponse.text()).toBe(201)
    const product = (await productResponse.json()).product; productId = product.id
    files.push(...product.photos.map((photo: { url: string }) => photo.url))
    const requestResponse = await owner.request.post('/api/buy-requests', { data: { ...common, latitude: 50.6299, longitude: 26.2616, title: requestTitle, description: '', quantity: 2, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller' } })
    expect(requestResponse.status(), await requestResponse.text()).toBe(201)
    const buyRequest = (await requestResponse.json()).buyRequest; requestId = buyRequest.id
    files.push(...buyRequest.photos.map((photo: { url: string }) => photo.url))
    for (const [path, photos] of [[`/api/products/${productId}`, product.photos], [`/api/buy-requests/${requestId}`, buyRequest.photos]] as const) {
      expect((await owner.request.patch(path, { data: { photos: [{ url: photos[1].url }, { url: photos[0].url }] } })).status()).toBe(200)
    }
    const page = await viewer.newPage()
    page.setDefaultTimeout(30_000)
    await page.goto(`/profiles/${encodeURIComponent(ownerCredentials.username)}`, { waitUntil: 'domcontentloaded' })
    const productCard = page.locator('.product-card').filter({ hasText: productTitle })
    await expect(productCard).toBeVisible()
    await expect.poll(async () => (await productCard.locator('.product-image img').last().getAttribute('src'))?.endsWith(product.photos[1].url)).toBe(true)
    const url = page.url()
    await productCard.getByRole('button', { name: 'Додати в обране' }).click()
    await expect(productCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible()
    expect(page.url()).toBe(url)
    await page.getByRole('tab', { name: /Запити на покупку/ }).click()
    const requestCard = page.locator('.buy-request-card').filter({ hasText: requestTitle })
    await expect(requestCard).toBeVisible()
    await expect.poll(async () => (await requestCard.locator('.buy-request-card-image img').last().getAttribute('src'))?.endsWith(buyRequest.photos[1].url)).toBe(true)
    await requestCard.getByRole('button', { name: 'Додати в обране' }).click()
    await expect(requestCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible()
    expect(page.url()).toBe(url)
    await page.screenshot({ path: 'docs/step-21-evidence/favorites-final.png', fullPage: true })
    await requestCard.getByRole('button', { name: 'Прибрати з обраного' }).click()
    await page.getByRole('tab', { name: /Усі товари/ }).click()
    await productCard.getByRole('button', { name: 'Прибрати з обраного' }).click()
    await page.goto('/map', { waitUntil: 'domcontentloaded' })
    await page.getByRole('searchbox', { name: /Пошук товару/ }).fill(suffix)
    await page.getByRole('combobox', { name: 'Населений пункт' }).click()
    await page.getByRole('option', { name: 'Рівненська область', exact: true }).click()
    await page.getByRole('button', { name: 'Вся область' }).click()
    await page.getByRole('button', { name: 'Знайти', exact: true }).click()
    const mapRequest = page.locator('.map-listing-result').filter({ hasText: requestTitle })
    await expect.poll(async () => await mapRequest.isVisible() || (await page.locator('.map-geo-group').count()) > 0, { timeout: 30_000 }).toBe(true)
    for (let level = 0; level < 3 && !await mapRequest.isVisible(); level++) {
      const groups = page.locator('.map-geo-group')
      await expect.poll(async () => await mapRequest.isVisible() || (await groups.count()) > 0, { timeout: 30_000 }).toBe(true)
      if (await mapRequest.isVisible()) break
      const before = (await groups.allTextContents()).join('|')
      await groups.first().click()
      await expect.poll(async () => await mapRequest.isVisible() || (await groups.allTextContents()).join('|') !== before, { timeout: 30_000 }).toBe(true)
    }
    await expect(mapRequest).toBeVisible()
    await expect.poll(async () => (await mapRequest.locator('img').last().getAttribute('src'))?.endsWith(buyRequest.photos[1].url)).toBe(true)
    await mapRequest.screenshot({ path: 'docs/step-21-evidence/map-request-card.png' })
    const pins = page.locator('.map-pin')
    await expect.poll(() => pins.count()).toBeGreaterThan(1)
    await page.locator('.map-pin:not(.map-pin-request)').first().click()
    await expect(page.locator('.map-summary')).toContainText(productTitle)
    await expect.poll(async () => (await page.locator('.map-listing-preview img').getAttribute('src'))?.endsWith(product.photos[1].url)).toBe(true)
    await page.screenshot({ path: 'docs/step-21-evidence/map-product-selected.png', fullPage: true })
    await page.getByRole('button', { name: '← Усі результати' }).click()
    for (let zoom = 0; zoom < 7 && !await page.locator('.map-pin-request').count(); zoom++) {
      await page.getByRole('button', { name: 'Zoom out' }).click()
      await page.waitForTimeout(350)
    }
    await expect(page.locator('.map-pin-request').first()).toBeVisible()
    await page.locator('.map-pin-request').first().click()
    await expect(page.locator('.map-summary')).toContainText(requestTitle)
    await expect.poll(async () => (await page.locator('.map-listing-preview img').getAttribute('src'))?.endsWith(buyRequest.photos[1].url)).toBe(true)
    console.log('Map marker switching: PASS')
    const back = page.getByRole('button', { name: '← Усі результати' })
    if (await back.isVisible()) await back.click()
  } finally {
    await Promise.allSettled([owner.close(), viewer.close()])
    const db = new Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    try {
      if (productId) await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [productId, ownerCredentials.username])
      if (requestId) await db.query('DELETE FROM buy_requests WHERE id=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [requestId, ownerCredentials.username])
    } finally { await db.end() }
    for (const url of files) if (/^\/uploads\/(products|buy-requests)\/[0-9a-f-]+(?:\/[0-9a-f-]+)?\/\d+\.(png|jpg|webp|gif)$/i.test(url)) await unlink(join('backend', url.slice(1))).catch(() => undefined)
  }
})
