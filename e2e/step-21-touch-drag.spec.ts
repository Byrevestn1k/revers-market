import { test, expect } from '@playwright/test'
import { readFile } from 'node:fs/promises'
import sharp from 'sharp'

test('Step 21: touch dragging in both listing forms', async ({ browser, baseURL }) => {
  test.setTimeout(180_000)
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n')
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0]
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim()
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim()
  if (!username || !password) throw new Error('Local QA account unavailable')
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 850 }, hasTouch: true, isMobile: true })
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200)
    const files = await Promise.all(['#2255aa', '#a65d31', '#3f9450'].map(async (background, index) => ({ name: `touch-${index}.png`, mimeType: 'image/png', buffer: await sharp({ create: { width: 180, height: 120, channels: 3, background } }).png().toBuffer() })))
    const page = await context.newPage()
    page.on('console', message => { if (message.text().startsWith('TOUCH-DEBUG ')) console.log(message.text()) })
    await page.addInitScript(() => {
      for (const type of ['pointerdown', 'pointerup', 'pointercancel']) document.addEventListener(type, event => {
        if (event.pointerType === 'touch') console.log('TOUCH-DEBUG ' + JSON.stringify({ type, x: event.clientX, y: event.clientY, target: (event.target as Element)?.closest('[data-photo-index]')?.getAttribute('data-photo-index'), hit: document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-photo-index]')?.getAttribute('data-photo-index') }))
      }, true)
    })
    const cdp = await context.newCDPSession(page)
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true })
    for (const [path, label] of [['/my/products/new', 'product'], ['/my/requests/new', 'request']] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded' })
      const picker = page.locator('.photo-picker')
      await picker.locator('input[type=file]').setInputFiles(files)
      await expect(picker.locator('.photo-picker-item')).toHaveCount(3)
      const from = picker.locator('.photo-picker-drag').nth(2), target = picker.locator('.photo-picker-drag').first()
      await from.evaluate(element => element.scrollIntoView({ block: 'center' }))
      const source = await from.locator('img').getAttribute('src')
      const a = (await from.boundingBox())!, b = (await target.boundingBox())!
      const beforeScroll = await page.evaluate(() => scrollY)
      const x1 = a.x + a.width / 2, y1 = a.y + a.height / 2, x2 = b.x + b.width / 2, y2 = b.y + b.height / 2
      console.log(JSON.stringify({ label, source: [x1, y1], target: [x2, y2], hit: await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.closest('[data-photo-index]')?.getAttribute('data-photo-index') ?? 'none', { x: x1, y: y1 }), viewport: await page.evaluate(() => [innerWidth, innerHeight, scrollY]) }))
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x: x1, y: y1 }] })
      await expect(picker.locator('.photo-picker-item').nth(2)).toHaveClass(/is-dragging/)
      await page.screenshot({ path: `docs/step-21-evidence/${label}-touch-drag-active-390.png` })
      for (let step = 1; step <= 8; step++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x: x1 + (x2 - x1) * step / 8, y: y1 + (y2 - y1) * step / 8 }] })
      await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] })
      await expect(picker.locator('img').first()).toHaveAttribute('src', source!)
      await expect(picker.locator('.photo-picker-item')).toHaveCount(3)
      expect(Math.abs((await page.evaluate(() => scrollY)) - beforeScroll)).toBeLessThanOrEqual(2)
      await page.screenshot({ path: `docs/step-21-evidence/${label}-touch-drag-390.png`, fullPage: true })
    }
    await cdp.detach()
  } finally { await context.close() }
})
