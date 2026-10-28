import { test, expect } from '@playwright/test'
import { readFile, writeFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Client } from 'pg'
import sharp from 'sharp'

test('Step 21: observe thumbnail and original network requests', async ({ browser, baseURL }) => {
  test.setTimeout(240_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password || !process.env.DATABASE_URL) throw new Error('Local QA account or database unavailable')
  const owner = await browser.newContext({ baseURL, viewport: { width: 320, height: 900 } })
  const received: { path: string; status: number; bytes: number }[] = []
  const responseTasks: Promise<void>[] = []
  let productId = ''
  const files: string[] = []
  try {
    expect((await owner.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200)
    const category = ((await (await owner.request.get('/api/categories')).json()).categories as { id: string; code: string }[]).find(item => item.code === 'grains')!
    const raw = Buffer.alloc(1200 * 800 * 3)
    let seed = 1
    for (let i = 0; i < raw.length; i++) { seed = (seed * 1664525 + 1013904223) >>> 0; raw[i] = seed >>> 24 }
    const jpeg = await sharp(raw, { raw: { width: 1200, height: 800, channels: 3 } }).jpeg({ quality: 80 }).toBuffer()
    const dataUrl = `data:image/jpeg;base64,${jpeg.toString('base64')}`
    const created = await owner.request.post('/api/products', { data: { categoryId: category.id, title: `Step21 traffic ${Date.now()}`, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: Array.from({ length: 8 }, () => ({ dataUrl })) } })
    expect(created.status(), await created.text()).toBe(201)
    const product = (await created.json()).product; productId = product.id
    files.push(...product.photos.map((photo: { url: string }) => photo.url))
    const page = await owner.newPage()
    page.on('response', response => {
      const path = new URL(response.url()).pathname
      if (path === '/api/photo-thumbnail' || path.startsWith(`/uploads/products/${productId}/`)) responseTasks.push(response.body().then(body => { received.push({ path, status: response.status(), bytes: body.length }) }).catch(() => undefined))
    })
    await page.goto(`/products/${productId}`, { waitUntil: 'domcontentloaded' })
    const gallery = page.locator('.request-gallery')
    await expect(gallery.locator('.request-gallery-main')).toBeVisible()
    await expect(gallery.locator('.request-gallery-thumbs button')).toHaveCount(8)
    await expect.poll(() => gallery.locator('.request-gallery-thumbs img[loading="lazy"]').count()).toBeGreaterThan(0)
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)
    await Promise.all(responseTasks)
    const before = [...received]
    expect(before.filter(entry => entry.path.startsWith('/uploads/')).length).toBe(1)
    expect(before.filter(entry => entry.path === '/api/photo-thumbnail').length).toBeLessThan(8)
    await gallery.locator('.request-gallery-thumbs').evaluate(element => { element.scrollLeft = element.scrollWidth })
    await expect.poll(async () => {
      const image = gallery.locator('.request-gallery-thumbs button').last().locator('img')
      return (await image.count()) > 0 && await image.evaluate((element: HTMLImageElement) => element.complete)
    }).toBe(true)
    await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined)
    await Promise.all(responseTasks)
    const after = [...received]
    expect(after.filter(entry => entry.path.startsWith('/uploads/')).length).toBe(1)
    expect(after.filter(entry => entry.path === '/api/photo-thumbnail').length).toBeGreaterThan(before.filter(entry => entry.path === '/api/photo-thumbnail').length)
    await page.screenshot({ path: 'docs/step-21-evidence/traffic-320.png', fullPage: true })
    await writeFile('docs/step-21-evidence/lazy-traffic.json', JSON.stringify({ originalFileBytes: jpeg.length, beforeScroll: before, afterScroll: after }, null, 2))
    console.log(JSON.stringify({ originalFileBytes: jpeg.length, thumbnailsBefore: before.filter(entry => entry.path === '/api/photo-thumbnail').length, thumbnailsAfter: after.filter(entry => entry.path === '/api/photo-thumbnail').length, originalsBefore: before.filter(entry => entry.path.startsWith('/uploads/')).length, originalsAfter: after.filter(entry => entry.path.startsWith('/uploads/')).length }))
    await gallery.locator('.request-gallery-thumbs button').last().click()
    await expect(gallery.locator('.gallery-controls').first()).toContainText('8 / 8')
    await gallery.getByRole('button', { name: 'Збільшити фото' }).click()
    await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toBeVisible()
    await page.keyboard.press('Escape')
    await expect(page.getByRole('dialog', { name: 'Перегляд фотографій' })).toHaveCount(0)
  } finally {
    await owner.close()
    const db = new Client({ connectionString: process.env.DATABASE_URL }); await db.connect()
    try { if (productId) await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [productId, username]) } finally { await db.end() }
    for (const url of files) if (/^\/uploads\/products\/[0-9a-f-]+(?:\/[0-9a-f-]+)?\/\d+\.(png|jpg|webp|gif)$/i.test(url)) await unlink(join('backend', url.slice(1))).catch(() => undefined)
  }
})
