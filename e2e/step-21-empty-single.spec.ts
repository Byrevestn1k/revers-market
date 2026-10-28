import { test, expect } from '@playwright/test'
import { readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test('Step 21: one photo and no photos in both listing galleries', async ({ browser, baseURL }) => {
  test.setTimeout(180_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password || !process.env.DATABASE_URL) throw new Error('Local QA account or database unavailable')
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 850 } })
  const files: string[] = []
  let productId = '', requestId = ''
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200)
    const category = ((await (await context.request.get('/api/categories')).json()).categories as { id: string; code: string }[]).find(item => item.code === 'grains')!
    const bytes = await sharp({ create: { width: 300, height: 180, channels: 3, background: '#a45a33' } }).png().toBuffer()
    const photos = [{ dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }]
    const stamp = Date.now()
    const productResponse = await context.request.post('/api/products', { data: { categoryId: category.id, title: `Step21 single product ${stamp}`, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos } })
    expect(productResponse.status(), await productResponse.text()).toBe(201)
    const product = (await productResponse.json()).product; productId = product.id; files.push(product.photos[0].url)
    const requestResponse = await context.request.post('/api/buy-requests', { data: { categoryId: category.id, title: `Step21 single request ${stamp}`, description: '', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller', photos } })
    expect(requestResponse.status(), await requestResponse.text()).toBe(201)
    const buyRequest = (await requestResponse.json()).buyRequest; requestId = buyRequest.id; files.push(buyRequest.photos[0].url)
    const page = await context.newPage()
    for (const [endpoint, path, label] of [[`/api/products/${productId}`, `/products/${productId}`, 'product'], [`/api/buy-requests/${requestId}`, `/buy-requests/${requestId}`, 'request']] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('button', { name: 'Збільшити фото' })).toBeVisible()
      await expect(page.getByRole('button', { name: 'Наступне фото' })).toHaveCount(0)
      await page.screenshot({ path: `docs/step-21-evidence/${label}-single-390.png`, fullPage: true })
      expect((await context.request.patch(endpoint, { data: { photos: [] } })).status()).toBe(200)
      await page.reload({ waitUntil: 'domcontentloaded' })
      await expect(page.locator('.request-gallery-empty')).toBeVisible()
      await page.screenshot({ path: `docs/step-21-evidence/${label}-empty-390.png`, fullPage: true })
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
