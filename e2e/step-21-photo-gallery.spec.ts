import { test, expect, type Page } from '@playwright/test'
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test.setTimeout(600_000)

test('Step 21: real Product and Buy Request photos', async ({ page, context, browser }) => {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  const viewerBlock = text.split('## Buyer A\n')[1]?.split('\n## ')[0]
  const viewerUsername = viewerBlock?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const viewerPassword = viewerBlock?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password || !process.env.DATABASE_URL) throw new Error('Local QA account or database unavailable')
  const files = await Promise.all(Array.from({ length: 9 }, async (_, i) => ({ name: `step21-${i}.png`, mimeType: 'image/png', buffer: await sharp({ create: { width: 200 + i * 2, height: 130, channels: 3, background: { r: 20 + i * 20, g: 50 + i * 8, b: 180 - i * 10 } } }).png().toBuffer() })))
  const data = files.map(f => `data:image/png;base64,${f.buffer.toString('base64')}`)
  const stamp = Date.now()
  const titleProduct = `Step21 product ${stamp}`
  const titleRequest = `Step21 request ${stamp}`
  const knownUrls = new Set<string>()
  let productId = '', requestId = ''
  const remember = (photos: { url: string }[]) => photos.forEach(photo => { if (photo.url.startsWith('/uploads/')) knownUrls.add(photo.url) })
  const evidence = 'docs/step-21-evidence'
  const traffic: { listing: string; path: string; status: number; bytes: number }[] = []
  page.setDefaultTimeout(30_000)
  try {
    await page.goto('/auth/login?return=%2Fmy%2Fproducts%2Fnew')
    await page.locator('input[name="username"]').fill(username)
    await page.locator('input[name="password"]').fill(password)
    await page.getByRole('button', { name: 'Увійти в акаунт' }).click()
    await expect(page).toHaveURL(/\/my\/products\/new$/, { timeout: 60_000 })
    for (const [path, label] of [['/my/products/new', 'product'], ['/my/requests/new', 'request']] as const) {
      await page.goto(path)
      const picker = page.locator('.photo-picker')
      await picker.locator('input[type=file]').setInputFiles(files.slice(0, 8))
      await expect(picker.locator('.photo-picker-item')).toHaveCount(8)
      await expect(picker.locator('input[type=file]')).toBeDisabled()
      await page.screenshot({ path: `${evidence}/${label}-eight.png`, fullPage: true })
      const first = await picker.locator('img').first().getAttribute('src')
      await picker.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
      await expect(picker.locator('img').nth(1)).toHaveAttribute('src', first!)
      await expect(picker.locator('.photo-picker-main')).toHaveCount(1)
      await page.screenshot({ path: `${evidence}/${label}-reordered.png`, fullPage: true })
      await picker.getByRole('button', { name: 'Видалити фото 8' }).click()
      await picker.locator('input[type=file]').setInputFiles(files.slice(7, 9))
      await expect(picker).toContainText('Зараз доступно ще 1')
      await expect(picker.locator('.photo-picker-item')).toHaveCount(7)
      await picker.locator('input[type=file]').setInputFiles(files[7])
      await expect(picker.locator('.photo-picker-item')).toHaveCount(8)
      for (const width of [320, 390, 768, 1024, 1280, 1440]) {
        await page.setViewportSize({ width, height: 900 })
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${label}: overflow ${width}`).toBe(true)
        await page.screenshot({ path: `${evidence}/${label}-${width}.png`, fullPage: true })
      }
      await page.setViewportSize({ width: 1440, height: 900 })
      const from = picker.locator('.photo-picker-drag').nth(7)
      const to = picker.locator('.photo-picker-drag').first()
      await from.scrollIntoViewIfNeeded()
      const moved = await from.locator('img').getAttribute('src')
      const a = (await from.boundingBox())!, b = (await to.boundingBox())!
      await page.mouse.move(a.x + a.width / 2, a.y + a.height / 2)
      await page.mouse.down()
      await page.mouse.move(b.x + b.width / 2, b.y + b.height / 2, { steps: 8 })
      await page.mouse.up()
      await expect(picker.locator('img').first()).toHaveAttribute('src', moved!)
      await page.screenshot({ path: `${evidence}/${label}-drag.png`, fullPage: true })
    }
    const categories = await (await page.request.get('/api/categories')).json()
    const categoryId = categories.categories.find((item: { code: string }) => item.code === 'grains').id
    const product = await page.request.post('/api/products', { data: { categoryId, title: titleProduct, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active', photos: data.slice(0, 3).map(dataUrl => ({ dataUrl })) } })
    expect(product.status(), await product.text()).toBe(201)
    const createdProduct = (await product.json()).product
    productId = createdProduct.id; remember(createdProduct.photos)
    const req = await page.request.post('/api/buy-requests', { data: { categoryId, title: titleRequest, description: '', quantity: 2, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller', photos: data.slice(0, 3).map(dataUrl => ({ dataUrl })) } })
    expect(req.status(), await req.text()).toBe(201)
    const createdRequest = (await req.json()).buyRequest
    requestId = createdRequest.id; remember(createdRequest.photos)
    await page.goto(`/my/products/${productId}/edit`)
    let picker = page.locator('.photo-picker')
    await expect(picker.locator('.photo-picker-item')).toHaveCount(3)
    await picker.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
    const productPatch = page.waitForResponse(r => new URL(r.url()).pathname === `/api/products/${productId}` && r.request().method() === 'PATCH')
    await page.getByRole('button', { name: 'Зберегти зміни' }).click()
    expect((await productPatch).status()).toBe(200)
    let fresh = (await (await page.request.get(`/api/products/${productId}`)).json()).product
    expect(fresh.photos.map((p: { url: string }) => p.url)).toEqual([createdProduct.photos[1].url, createdProduct.photos[0].url, createdProduct.photos[2].url])
    await page.goto(`/my/products/${productId}/edit`); await page.reload()
    await expect.poll(async () => (await page.locator('.photo-picker-item img').first().getAttribute('src'))?.endsWith(createdProduct.photos[1].url)).toBe(true)
    await page.goto('/my/requests')
    await page.locator('.buy-request-card').filter({ hasText: titleRequest }).getByRole('button', { name: 'Редагувати' }).click()
    const dialog = page.getByRole('dialog', { name: 'Редагувати запит' })
    picker = dialog.locator('.photo-picker')
    await expect(picker.locator('.photo-picker-item')).toHaveCount(3)
    await picker.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
    const requestPatch = page.waitForResponse(r => new URL(r.url()).pathname === `/api/buy-requests/${requestId}` && r.request().method() === 'PATCH')
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click()
    expect((await requestPatch).status()).toBe(200)
    fresh = (await (await page.request.get(`/api/buy-requests/${requestId}`)).json()).buyRequest
    expect(fresh.photos.map((p: { url: string }) => p.url)).toEqual([createdRequest.photos[1].url, createdRequest.photos[0].url, createdRequest.photos[2].url])
    await page.reload()
    await page.locator('.buy-request-card').filter({ hasText: titleRequest }).getByRole('button', { name: 'Редагувати' }).click()
    await expect.poll(async () => (await page.getByRole('dialog', { name: 'Редагувати запит' }).locator('.photo-picker-item img').first().getAttribute('src'))?.endsWith(createdRequest.photos[1].url)).toBe(true)
    await page.getByRole('dialog', { name: 'Редагувати запит' }).getByRole('button', { name: 'Скасувати' }).click()
    for (const [path, label] of [[`/products/${productId}`, 'product'], [`/buy-requests/${requestId}`, 'request']] as const) {
      const network: string[] = []
      const responses: Promise<void>[] = []
      const listener = (request: import('@playwright/test').Request) => network.push(new URL(request.url()).pathname)
      const record = (response: import('@playwright/test').Response) => {
        const path = new URL(response.url()).pathname
        if (path === '/api/photo-thumbnail' || path.startsWith('/uploads/')) responses.push(response.body().then(body => { traffic.push({ listing: label, path, status: response.status(), bytes: body.length }) }).catch(() => undefined))
      }
      page.on('request', listener)
      page.on('response', record)
      await page.goto(path); await expect(page.locator('.request-gallery-main')).toBeVisible()
      await expect(page.locator('.gallery-controls').first()).toContainText('1 / 3')
      await expect.poll(() => network.filter(item => item.startsWith(label === 'product' ? '/uploads/products/' : '/uploads/buy-requests/')).length).toBe(1)
      console.log(`${label} originals requested before navigation: ${network.filter(item => item.startsWith(label === 'product' ? '/uploads/products/' : '/uploads/buy-requests/')).length}`)
      await page.getByRole('button', { name: 'Наступне фото' }).first().click()
      await expect(page.locator('.gallery-controls').first()).toContainText('2 / 3')
      await page.getByRole('button', { name: 'Попереднє фото' }).first().click()
      await expect(page.locator('.gallery-controls').first()).toContainText('1 / 3')
      await page.getByRole('button', { name: 'Наступне фото' }).first().click()
      await page.getByRole('button', { name: 'Збільшити фото' }).click()
      await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toBeVisible()
      await page.screenshot({ path: `${evidence}/${label}-gallery.png`, fullPage: true })
      await page.getByRole('dialog', { name: 'Перегляд фотографій' }).getByRole('button', { name: 'Закрити' }).click()
      await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toHaveCount(0)
      await page.getByRole('button', { name: 'Збільшити фото' }).click()
      await page.keyboard.press('Escape')
      await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toHaveCount(0)
      await page.setViewportSize({ width: 390, height: 850 })
      await page.locator('.gallery-open').scrollIntoViewIfNeeded()
      const box = (await page.locator('.gallery-open').boundingBox())!
      const cdp = await context.newCDPSession(page)
      await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: box.x + box.width * 0.8, y: box.y + box.height / 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: box.x + box.width * 0.2, y: box.y + box.height / 2 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(page.locator('.gallery-controls').first()).toContainText('3 / 3')
      await cdp.detach()
      expect(network).toContain('/api/photo-thumbnail')
      await Promise.all(responses)
      console.log(`${label} thumbnail requests: ${network.filter(p => p === '/api/photo-thumbnail').length}`)
      page.off('request', listener)
      page.off('response', record)
    }
    await writeFile(`${evidence}/traffic.json`, JSON.stringify(traffic, null, 2))
    if (!viewerUsername || !viewerPassword) throw new Error('Local viewer QA account unavailable')
    const viewer = await browser.newContext({ baseURL: new URL(page.url()).origin, viewport: { width: 1440, height: 900 } })
    try {
      expect((await viewer.request.post('/api/auth/login', { data: { username: viewerUsername, password: viewerPassword } })).status()).toBe(200)
      const guestPage = await viewer.newPage()
      await guestPage.goto(`/profiles/${encodeURIComponent(username)}`)
      const productCard = guestPage.locator('.product-card').filter({ hasText: titleProduct })
      await expect(productCard).toBeVisible()
      await expect.poll(async () => (await productCard.locator('.product-image img').last().getAttribute('src'))?.endsWith(createdProduct.photos[1].url)).toBe(true)
      const productImage = (await productCard.locator('.product-image').boundingBox())!
      const productHeart = (await productCard.getByRole('button', { name: 'Додати в обране' }).boundingBox())!
      expect(productHeart.x + productHeart.width).toBeLessThanOrEqual(productImage.x + productImage.width + 1)
      expect(productHeart.y + productHeart.height).toBeLessThanOrEqual(productImage.y + productImage.height + 1)
      const profileUrl = guestPage.url()
      await productCard.getByRole('button', { name: 'Додати в обране' }).click()
      await expect(productCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible()
      expect(guestPage.url()).toBe(profileUrl)
      await guestPage.getByRole('tab', { name: /Запити на покупку/ }).click()
      const requestCard = guestPage.locator('.buy-request-card').filter({ hasText: titleRequest })
      await expect(requestCard).toBeVisible()
      await expect.poll(async () => (await requestCard.locator('.buy-request-card-image img').last().getAttribute('src'))?.endsWith(createdRequest.photos[1].url)).toBe(true)
      const requestImage = (await requestCard.locator('.buy-request-card-image').boundingBox())!
      const requestHeart = (await requestCard.getByRole('button', { name: 'Додати в обране' }).boundingBox())!
      expect(requestHeart.x + requestHeart.width).toBeLessThanOrEqual(requestImage.x + requestImage.width + 1)
      expect(requestHeart.y + requestHeart.height).toBeLessThanOrEqual(requestImage.y + requestImage.height + 1)
      await requestCard.getByRole('button', { name: 'Додати в обране' }).click()
      await expect(requestCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible()
      expect(guestPage.url()).toBe(profileUrl)
      await guestPage.screenshot({ path: `${evidence}/favorites-1440.png`, fullPage: true })
      await requestCard.getByRole('button', { name: 'Прибрати з обраного' }).click()
      await guestPage.getByRole('tab', { name: /Усі товари/ }).click()
      await productCard.getByRole('button', { name: 'Прибрати з обраного' }).click()
      await guestPage.goto('/map')
      await guestPage.getByRole('searchbox', { name: /Пошук товару/ }).fill(String(stamp))
      await guestPage.getByRole('combobox', { name: 'Населений пункт' }).click()
      await guestPage.getByRole('option', { name: 'Рівненська область', exact: true }).click()
      await guestPage.getByRole('button', { name: 'Вся область' }).click()
      await guestPage.getByRole('button', { name: 'Знайти', exact: true }).click()
      const mapRequest = guestPage.locator('.map-listing-result').filter({ hasText: titleRequest })
      await expect.poll(async () => await mapRequest.isVisible() || (await guestPage.locator('.map-geo-group').count()) > 0, { timeout: 30_000 }).toBe(true)
      for (let level = 0; level < 3 && !await mapRequest.isVisible(); level++) {
        const groups = guestPage.locator('.map-geo-group')
        await expect.poll(async () => await mapRequest.isVisible() || (await groups.count()) > 0, { timeout: 30_000 }).toBe(true)
        if (await mapRequest.isVisible()) break
        const before = (await groups.allTextContents()).join('|')
        await groups.first().click()
        await expect.poll(async () => await mapRequest.isVisible() || (await groups.allTextContents()).join('|') !== before).toBe(true)
      }
      await expect(mapRequest).toBeVisible()
      await expect.poll(async () => (await mapRequest.locator('img').last().getAttribute('src'))?.endsWith(createdRequest.photos[1].url)).toBe(true)
      await guestPage.screenshot({ path: `${evidence}/map-1440.png`, fullPage: true })
      await guestPage.locator('.map-profile-result .map-result').first().click()
      const mapProduct = guestPage.locator('.map-listing-result').filter({ hasText: titleProduct })
      await expect(mapProduct).toBeVisible()
      await expect.poll(async () => (await mapProduct.locator('img').last().getAttribute('src'))?.endsWith(createdProduct.photos[1].url)).toBe(true)
      await expect.poll(() => guestPage.locator('.map-pin').count()).toBeGreaterThan(0)
      await guestPage.locator('.map-pin').first().click()
      await expect(guestPage.locator('.map-summary')).toContainText(String(stamp))
      if (await guestPage.locator('.map-pin').count() > 1) {
        await guestPage.locator('.map-pin').last().click()
        await expect(guestPage.locator('.map-summary')).toContainText(String(stamp))
        console.log('Map marker switching: checked')
      } else console.log('Map marker switching: UNVERIFIED (only one visible marker)')
    } finally { await viewer.close() }
    for (const [endpoint, path, photo] of [
      [`/api/products/${productId}`, `/products/${productId}`, createdProduct.photos[1]],
      [`/api/buy-requests/${requestId}`, `/buy-requests/${requestId}`, createdRequest.photos[1]],
    ] as const) {
      expect((await page.request.patch(endpoint, { data: { photos: [{ url: photo.url }] } })).status()).toBe(200)
      await page.goto(path)
      await expect(page.getByRole('button', { name: 'Збільшити фото' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Наступне фото' })).toHaveCount(0)
      expect((await page.request.patch(endpoint, { data: { photos: [] } })).status()).toBe(200)
      await page.reload()
      await expect(page.locator('.request-gallery-empty')).toBeVisible()
    }
  } finally {
    await context.close()
    const db = new Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    try {
      if (productId) await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [productId, username])
      if (requestId) await db.query('DELETE FROM buy_requests WHERE id=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [requestId, username])
    } finally { await db.end() }
    for (const url of knownUrls) if (/^\/uploads\/(products|buy-requests)\/[0-9a-f-]+(?:\/[0-9a-f-]+)?\/\d+\.(png|jpg|webp|gif)$/i.test(url)) await unlink(join('backend', url.slice(1))).catch(() => undefined)
  }
})
