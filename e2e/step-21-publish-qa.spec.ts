import { test, expect } from '@playwright/test'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test('Step 21: publish Product and Buy Request with zero and eight photos', async ({ browser, baseURL }) => {
  test.setTimeout(420_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password || !process.env.DATABASE_URL) throw new Error('Local QA account or database unavailable')
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
  const created: { type: 'product' | 'request'; id: string; urls: string[] }[] = []
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200)
    const category = (await (await context.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains')
    expect(category).toBeTruthy()
    const files = await Promise.all(Array.from({ length: 8 }, async (_, i) => ({ name: `publish-${i}.png`, mimeType: 'image/png', buffer: await sharp({ create: { width: 180, height: 120, channels: 3, background: { r: 20 + i * 25, g: 80, b: 180 - i * 15 } } }).png().toBuffer() })))
    const page = await context.newPage()
    page.setDefaultTimeout(40_000)
    for (const type of ['product', 'request'] as const) for (const count of [0, 8]) {
      await page.goto(type === 'product' ? '/my/products/new' : '/my/requests/new', { waitUntil: 'domcontentloaded' })
      await page.locator('input[name="title"]').fill(`Step21 publish ${type} ${count} ${Date.now()}`)
      await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(category.name)
      await page.getByRole('option').filter({ hasText: category.name }).last().click()
      await page.locator('input[name="quantity"]').fill('2')
      if (type === 'product') {
        await page.locator('input[name="price"]').fill('100')
        await page.getByRole('checkbox', { name: 'Поштова доставка' }).check()
      } else await page.getByRole('checkbox', { name: 'Можна домовитися' }).check()
      if (count) {
        await page.locator('.photo-picker input[type=file]').setInputFiles(files)
        await expect(page.locator('.photo-picker-item')).toHaveCount(8)
        await page.locator('.photo-picker').getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
      }
      const endpoint = type === 'product' ? '/api/products' : '/api/buy-requests'
      const responsePromise = page.waitForResponse(response => new URL(response.url()).pathname === endpoint && response.request().method() === 'POST', { timeout: 90_000 })
      await page.getByRole('button', { name: type === 'product' ? 'Опублікувати товар' : 'Опублікувати запит' }).click()
      const response = await responsePromise
      expect(response.status(), await response.text()).toBe(201)
      const body = await response.json()
      const listing = type === 'product' ? body.product : body.buyRequest
      created.push({ type, id: listing.id, urls: listing.photos.map((photo: { url: string }) => photo.url) })
      expect(listing.photos).toHaveLength(count)
      const persisted = await (await context.request.get(`${endpoint}/${listing.id}`)).json()
      expect((type === 'product' ? persisted.product : persisted.buyRequest).photos.map((photo: { url: string }) => photo.url)).toEqual(listing.photos.map((photo: { url: string }) => photo.url))
      console.log(`${type} publication with ${count} photos: PASS`)
    }
  } finally {
    await context.close()
    const db = new Client({ connectionString: process.env.DATABASE_URL })
    await db.connect()
    try {
      for (const item of created) {
        if (item.type === 'product') await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [item.id, username])
        else await db.query('DELETE FROM buy_requests WHERE id=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [item.id, username])
      }
    } finally { await db.end() }
    for (const item of created) for (const url of item.urls) if (/^\/uploads\/(products|buy-requests)\/[0-9a-f-]+(?:\/[0-9a-f-]+)?\/\d+\.(png|jpg|webp|gif)$/i.test(url)) await unlink(join('backend', url.slice(1))).catch(() => undefined)
  }
})
