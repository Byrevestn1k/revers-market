import { test, expect } from '@playwright/test'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test('Step 21: mixed photos survive failed save and retry', async ({ browser, baseURL }) => {
  test.setTimeout(420_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim(), password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password || !process.env.DATABASE_URL) throw new Error('Local QA account or database unavailable')
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
  const created: { type: 'product' | 'request'; id: string; urls: string[] }[] = []
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200)
    const category = (await (await context.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains')
    const buffers = await Promise.all(['#2255aa', '#a65d31', '#3f9450'].map(background => sharp({ create: { width: 180, height: 120, channels: 3, background } }).png().toBuffer()))
    const photos = buffers.slice(0, 2).map(buffer => ({ dataUrl: `data:image/png;base64,${buffer.toString('base64')}` }))
    const common = { categoryId: category.id, settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', photos }
    const page = await context.newPage(); page.setDefaultTimeout(40_000)
    for (const type of (process.env.STEP21_EDIT_TYPE === 'request' ? ['request'] as const : ['product', 'request'] as const)) {
      const title = `Step21 edit ${type} ${Date.now()}`
      const endpoint = type === 'product' ? '/api/products' : '/api/buy-requests'
      const data = type === 'product' ? { ...common, title, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active' } : { ...common, title, description: '', quantity: 2, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller' }
      const response = await context.request.post(endpoint, { data }); expect(response.status(), await response.text()).toBe(201)
      const body = await response.json(), listing = type === 'product' ? body.product : body.buyRequest
      const item = { type, id: listing.id as string, urls: listing.photos.map((photo: { url: string }) => photo.url) as string[] }; created.push(item)
      if (type === 'product') await page.goto(`/my/products/${item.id}/edit`, { waitUntil: 'domcontentloaded' })
      else { await page.goto('/my/requests', { waitUntil: 'domcontentloaded' }); await page.locator('.buy-request-card').filter({ hasText: title }).getByRole('button', { name: 'Редагувати' }).click() }
      const form = type === 'product' ? page.locator('form').filter({ has: page.locator('.photo-picker') }) : page.getByRole('dialog', { name: 'Редагувати запит' })
      const picker = form.locator('.photo-picker')
      await expect(picker.locator('.photo-picker-item')).toHaveCount(2)
      await picker.getByRole('button', { name: 'Видалити фото 1' }).click()
      await picker.locator('input[type=file]').setInputFiles({ name: 'new.png', mimeType: 'image/png', buffer: buffers[2] })
      await expect(picker.locator('.photo-picker-item')).toHaveCount(2)
      await picker.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
      const target = `${endpoint}/${item.id}`
      const handler = async (route: import('@playwright/test').Route) => { if (route.request().method() === 'PATCH') await route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"QA save failure"}' }); else await route.continue() }
      await page.route(`**${target}`, handler)
      const failed = page.waitForResponse(r => new URL(r.url()).pathname === target && r.request().method() === 'PATCH')
      const save = form.getByRole('button', { name: type === 'product' ? 'Зберегти зміни' : 'Зберегти', exact: true })
      await save.click(); expect((await failed).status()).toBe(500)
      await expect(picker.locator('.photo-picker-item')).toHaveCount(2)
      const old = await (await context.request.get(target)).json()
      expect((type === 'product' ? old.product : old.buyRequest).photos.map((photo: { url: string }) => photo.url)).toEqual(item.urls)
      await page.unroute(`**${target}`, handler)
      let saves = 0; page.on('request', request => { if (new URL(request.url()).pathname === target && request.method() === 'PATCH') saves++ })
      const saved = page.waitForResponse(r => new URL(r.url()).pathname === target && r.request().method() === 'PATCH', { timeout: 90_000 })
      await save.dblclick(); expect((await saved).status()).toBe(200)
      const fresh = await (await context.request.get(target)).json(), updated = type === 'product' ? fresh.product : fresh.buyRequest
      const urls = updated.photos.map((photo: { url: string }) => photo.url)
      expect(urls).toHaveLength(2); expect(urls[1]).toBe(item.urls[1]); expect(urls[0]).not.toBe(item.urls[0]); expect(urls[0]).not.toBe(item.urls[1])
      item.urls.push(...urls); expect(saves).toBe(1)
      console.log(`${type} mixed photos, failed save, retry and double click: PASS`)
    }
  } finally {
    await context.close()
    const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect()
    try { for (const item of created) if (item.type === 'product') await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [item.id, username]); else await db.query('DELETE FROM buy_requests WHERE id=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [item.id, username]) } finally { await db.end() }
    for (const item of created) for (const url of item.urls) if (/^\/uploads\/(products|buy-requests)\/[0-9a-f-]+(?:\/[0-9a-f-]+)?\/\d+\.(png|jpg|webp|gif)$/i.test(url)) await unlink(join('backend', url.slice(1))).catch(() => undefined)
  }
})
