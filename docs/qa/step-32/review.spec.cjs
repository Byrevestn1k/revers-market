const { test, expect } = require('@playwright/test')
const fs = require('fs')

const accounts = fs.readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8')
function account(name) {
  const block = accounts.split(`## ${name}`)[1]?.split('\n## ')[0] ?? ''
  const username = block.match(/^Username:\s*(.+)$/m)?.[1].trim()
  const password = block.match(/^Password:\s*(.+)$/m)?.[1].trim()
  if (!username || !password) throw new Error(`Missing local QA account ${name}`)
  return { username, password }
}
async function login(page, user) {
  await page.locator('input[name="username"]').fill(user.username)
  await page.locator('input[name="password"]').fill(user.password)
  const response = page.waitForResponse(r => r.url().includes('/api/auth/login') && r.request().method() === 'POST')
  await page.getByRole('button', { name: 'Увійти в акаунт' }).click()
  expect((await response).status()).toBe(200)
}

for (const width of [390, 1280]) {
  for (const [intent, route, heading, name] of [
    ['Створити запит', '/my/requests/new', 'Створити запит на купівлю', 'Buyer A'],
    ['Продати товар', '/my/products/new', 'Додати товар', 'Seller A'],
  ]) {
    test(`real auth ${intent} ${width}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' })
      const page = await context.newPage()
      await page.goto('/discover', { waitUntil: 'domcontentloaded' })
      await expect(page.getByRole('heading', { name: 'Що ви хочете зробити?' })).toBeVisible()
      await page.getByRole('button', { name: new RegExp(intent) }).click()
      await expect(page.getByRole('heading', { name: 'Потрібен вхід' })).toBeVisible()
      await page.getByRole('button', { name: 'Увійти або зареєструватися' }).click()
      await expect(page).toHaveURL(/\/auth\/login/)
      await expect(page.getByLabel('Покрокові підказки')).toHaveCount(0)
      if (width === 390 && name === 'Seller A') await page.reload({ waitUntil: 'domcontentloaded' })
      await login(page, account(name))
      await expect(page).toHaveURL(new RegExp(route + '$'))
      await expect(page.getByRole('heading', { name: heading })).toBeVisible()
      await expect(page.locator('form.listing-form input[name="title"]')).toBeVisible()
      await expect(page.getByLabel('Покрокові підказки')).toContainText('Назва товару')
      await page.screenshot({ path: `docs/qa/step-32/review-${name === 'Buyer A' ? 'request' : 'product'}-${width}.png` })
      await context.close()
    })
  }

  for (const [route, name] of [['/my/products/new', 'Seller A'], ['/my/requests/new', 'Buyer A']]) {
    test(`protect form and Back ${name} ${width}`, async ({ browser }) => {
      const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' })
      const page = await context.newPage()
      await page.goto('/auth/login?return=' + encodeURIComponent(route), { waitUntil: 'domcontentloaded' })
      await page.getByRole('button', { name: 'Пропустити вступ' }).click()
      await login(page, account(name))
      await expect(page).toHaveURL(new RegExp(route + '$'))
      const title = page.locator('form.listing-form input[name="title"]')
      await title.fill('Незбережена назва QA')
      await page.getByRole('button', { name: 'Центр допомоги' }).click()
      await page.getByRole('button', { name: 'Згорнути' }).click()
      let prompts = 0
      page.once('dialog', dialog => { prompts++; void dialog.dismiss() })
      if (width === 390) await page.getByRole('navigation', { name: 'Основна навігація' }).getByRole('button', { name: /Знайти/ }).click()
      else await page.locator('.sidebar').getByRole('button', { name: /Знайти/ }).click()
      await expect(page).toHaveURL(new RegExp(route + '$'))
      await expect(title).toHaveValue('Незбережена назва QA')
      expect(prompts).toBe(1)
      page.once('dialog', dialog => { prompts++; void dialog.dismiss() })
      await page.goBack({ waitUntil: 'domcontentloaded' }).catch(() => undefined)
      await expect(page).toHaveURL(new RegExp(route + '$'))
      await expect(title).toHaveValue('Незбережена назва QA')
      expect(prompts).toBe(2)
      if (width === 1280) {
        page.once('dialog', dialog => { prompts++; void dialog.dismiss() })
        await page.locator('.view-breadcrumbs').getByRole('link', { name: 'Головна' }).click()
        await expect(title).toHaveValue('Незбережена назва QA')
        expect(prompts).toBe(3)
        page.once('dialog', dialog => { prompts++; void dialog.dismiss() })
        await page.locator('.sidebar').getByRole('button', { name: /Вийти/ }).click()
        await expect(title).toHaveValue('Незбережена назва QA')
        expect(prompts).toBe(4)
      }
      page.once('dialog', dialog => { prompts++; void dialog.accept() })
      if (width === 390) await page.getByRole('navigation', { name: 'Основна навігація' }).getByRole('button', { name: /Знайти/ }).click()
      else await page.locator('.sidebar').getByRole('button', { name: /Знайти/ }).click()
      await expect(page).toHaveURL(/\/discover$/)
      expect(prompts).toBe(width === 1280 ? 5 : 3)
      await context.close()
    })
  }

  test(`guest find and PWA ${width}`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 844 }, serviceWorkers: 'block' })
    const page = await context.newPage()
    await page.goto('/discover', { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(1500)
    await expect(page.getByLabel('Встановлення застосунку')).toHaveCount(0)
    await page.getByRole('button', { name: /Знайти товар/ }).click()
    await expect(page).toHaveURL(/\/discover$/)
    await expect(page.getByLabel('Покрокові підказки')).toBeVisible()
    await expect(page.getByLabel('Встановлення застосунку')).toHaveCount(0)
    await context.close()
  })
}

test('cancelled authentication clears the pending guide', async ({ browser }) => {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' })
  const page = await context.newPage()
  await page.goto('/discover', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: /Створити запит/ }).click()
  await page.getByRole('button', { name: 'Увійти або зареєструватися' }).click()
  await expect(page).toHaveURL(/\/auth\/login/)
  await page.goBack({ waitUntil: 'domcontentloaded' })
  await expect(page).toHaveURL(/\/discover$/)
  await expect.poll(() => page.evaluate(() => sessionStorage.getItem('deshchotreba.help.intent'))).toBeNull()
  await expect(page.getByLabel('Покрокові підказки')).toHaveCount(0)
  await context.close()
})
