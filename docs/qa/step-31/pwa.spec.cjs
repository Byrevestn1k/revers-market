const { test, expect } = require('@playwright/test')
const fs = require('fs')
const path = require('path')

const baseUrl = process.env.STEP31_BASE_URL || 'http://127.0.0.1:5191'
for (const width of [390, 1280]) test(`PWA UI, network and offline ${width}`, async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'allow' })
  const page = await context.newPage()
  await page.goto(`${baseUrl}/`, { waitUntil: 'domcontentloaded' })
  await page.evaluate(() => navigator.serviceWorker.ready)
  expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.active?.scriptURL)).toContain('/sw.js')
  const manifest = await page.locator('link[rel="manifest"]').getAttribute('href')
  expect(manifest).toBe('/manifest.webmanifest')
  if (width === 390) {
    await expect(page.getByText('Встановіть застосунок ДещоТреба')).toBeVisible({ timeout: 15000 })
    await page.getByRole('button', { name: 'Не зараз' }).first().click()
    await page.reload({ waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1700)
    await expect(page.getByText('Встановіть застосунок ДещоТреба')).toHaveCount(0)
    await page.getByLabel('Меню встановлення').click()
    await page.getByRole('button', { name: 'Встановити застосунок' }).click()
    await expect(page.getByText('Встановіть застосунок ДещоТреба')).toBeVisible()
    await page.getByRole('button', { name: 'Встановити застосунок' }).first().click()
    await expect(page.getByText(/Відкрийте меню браузера/)).toBeVisible()
    await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')))
    await expect(page.getByText('Встановіть застосунок ДещоТреба')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Встановити застосунок' })).toHaveCount(0)
  }
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
  const cached = await page.evaluate(async () => { await fetch('/api/notifications').catch(() => {}); const keys = await caches.keys(); return Promise.all(keys.map(async key => (await (await caches.open(key)).keys()).map(req => new URL(req.url).pathname))) })
  expect(cached.flat()).not.toContain('/api/notifications')
  expect(cached.flat()).not.toContain('/')
  await context.setOffline(true)
  await page.goto(`${baseUrl}/products/test`)
  await expect(page.getByRole('heading', { name: 'Немає з’єднання' })).toBeVisible()
  await context.close()
})

test('user action invokes install prompt and update preserves form', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' })
  const page = await context.newPage()
  await page.addInitScript(() => {
    window.installPromptCount = 0
    window.addEventListener('load', () => {
      const event = new Event('beforeinstallprompt', { cancelable: true })
      event.prompt = async () => { window.installPromptCount++ }
      event.userChoice = Promise.resolve({ outcome: 'dismissed' })
      window.dispatchEvent(event)
    })
  })
  await page.goto(`${baseUrl}/`)
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.reload()
  await expect(page.getByText('Встановіть застосунок ДещоТреба')).toBeVisible({ timeout: 15000 })
  expect(await page.evaluate(() => window.installPromptCount)).toBe(0)
  await page.getByRole('button', { name: 'Встановити застосунок' }).first().click()
  expect(await page.evaluate(() => window.installPromptCount)).toBe(1)
  await page.evaluate(() => { const input = document.createElement('input'); input.id = 'sw-unsaved-test'; input.value = 'незбережені дані'; document.body.append(input) })
  const worker = path.resolve('frontend/public/sw.js')
  const original = fs.readFileSync(worker, 'utf8')
  try {
    fs.writeFileSync(worker, original + '\n// QA update\n')
    await page.evaluate(async () => { const registration = await navigator.serviceWorker.ready; await registration.update() })
    await expect.poll(() => page.evaluate(async () => !!(await navigator.serviceWorker.ready).waiting), { timeout: 15000 }).toBe(true)
    expect(await page.locator('#sw-unsaved-test').inputValue()).toBe('незбережені дані')
    expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true)
  } finally { fs.writeFileSync(worker, original); await context.close() }
})
