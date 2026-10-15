import { expect, test } from '@playwright/test'
import { Client } from 'pg'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')

test('buyer creates and edits a photographed request; seller finds and offers; buyer selects', async ({ browser }) => {
  test.setTimeout(360_000)
  const stamp = Date.now().toString(36)
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const stranger = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const guest = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const actors = [buyer, seller, stranger]
  const ids: string[] = []
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  try {
    await expect.poll(async () => (await buyer.request.get('/api/categories')).status(), { timeout: 60_000 }).toBe(200)
    for (const [index, context] of actors.entries()) {
      const username = `step12_${index}_${stamp}`
      const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Date.now()).slice(-6)}${index}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
      expect(response.status(), await response.text()).toBe(201)
      ids.push((await response.json() as { user: { id: string } }).user.id)
      expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200)
      expect((await context.request.get('/api/auth/me')).status()).toBe(200)
      expect((await context.request.patch('/api/profile/me', { data: { location: 'Рівне', mapLocation: { mode: 'pin', latitude: 50.6199, longitude: 26.2516, consent: true } } })).status()).toBe(200)
    }
    const buyerPage = await buyer.newPage()
    await buyerPage.goto('/my/requests/new')
    await expect(buyerPage.getByRole('heading', { name: 'Створити запит на купівлю' })).toBeVisible()
    const originalTitle = `Step 12 request ${stamp}`
    await buyerPage.getByLabel('Назва товару').fill(originalTitle)
    await buyerPage.getByRole('combobox', { name: 'Пошук або вибір категорії' }).click()
    await buyerPage.getByRole('option').first().click()
    await buyerPage.getByLabel('Кількість').fill('2')
    await buyerPage.getByLabel('Додати фотографії').setInputFiles({ name: 'sample.png', mimeType: 'image/png', buffer: png })
    await expect(buyerPage.getByText('Головне')).toBeVisible()
    await buyerPage.getByLabel('Один продавець').check()
    await buyerPage.getByLabel('Спосіб отримання').selectOption('SELF_PICKUP')
    await expect(buyerPage.getByText('✓ Точку для мапи визначено')).toBeVisible()
    for (const width of [320, 390, 1440]) {
      await buyerPage.setViewportSize({ width, height: 900 })
      expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px form overflow`).toBe(true)
      await expect(buyerPage.getByRole('button', { name: 'Опублікувати запит' })).toBeVisible()
      if (width < 600) {
        await buyerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const submitBox = (await buyerPage.getByRole('button', { name: 'Опублікувати запит' }).boundingBox())!
        const navigationBox = (await buyerPage.getByRole('navigation', { name: 'Основна навігація' }).boundingBox())!
        expect(submitBox.y + submitBox.height, `${width}px submit above navigation`).toBeLessThanOrEqual(navigationBox.y)
      }
    }
    await buyerPage.getByRole('button', { name: 'Опублікувати запит' }).click()
    await expect(buyerPage).toHaveURL(/\/map$/)
    await buyerPage.goto('/my/requests')
    const mine = await buyer.request.get('/api/buy-requests', { params: { mine: 'true' } })
    expect(mine.status()).toBe(200)
    const item = (await mine.json() as { buyRequests: Array<{ id: string; title: string; category: { id: string }; photos: { url: string }[] }> }).buyRequests.find(row => row.title === originalTitle)
    expect(item).toBeTruthy()
    expect(item!.photos).toHaveLength(1)
    const noPhotoTitle = `Step 12 without photo ${stamp}`
    const noPhoto = await buyer.request.post('/api/buy-requests', { data: {
      categoryId: item!.category.id, title: noPhotoTitle, description: '', quantity: 1,
      unit: 'piece', currency: 'UAH', geoArea: 'Рівне', latitude: 50.6199, longitude: 26.2516,
      mapLocationMode: 'pin', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller',
    } })
    expect(noPhoto.status()).toBe(201)
    await buyerPage.reload()
    const ownCard = buyerPage.getByRole('button', { name: `Відкрити запит: ${originalTitle}` })
    await expect(ownCard).toBeVisible()
    await expect(buyerPage.getByRole('button', { name: `Відкрити запит: ${noPhotoTitle}` })).toBeVisible()
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyerPage.setViewportSize({ width, height: 900 })
      expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px own list overflow`).toBe(true)
      if ([1440, 390, 320].includes(width)) await buyerPage.screenshot({ path: `test-results/step12-my-requests-${width}.png`, fullPage: true })
      if (width < 600) {
        await buyerPage.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const actionBox = (await buyerPage.getByRole('button', { name: 'Закрити запит' }).last().boundingBox())!
        const navigationBox = (await buyerPage.getByRole('navigation', { name: 'Основна навігація' }).boundingBox())!
        expect(actionBox.y + actionBox.height, `${width}px action above navigation`).toBeLessThanOrEqual(navigationBox.y)
      }
    }
    await ownCard.locator('xpath=..').getByRole('button', { name: 'Редагувати' }).click()
    const edit = buyerPage.getByRole('dialog', { name: 'Редагувати запит' })
    const editedTitle = `Step 12 edited ${stamp}`
    await edit.getByLabel('Назва товару').fill(editedTitle)
    await edit.getByLabel('Додати фотографії').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: png })
    await expect(edit.locator('.photo-picker-item')).toHaveCount(2)
    await edit.getByRole('button', { name: 'Зберегти' }).click()
    await expect(edit).toHaveCount(0)
    await buyerPage.goto(`/buy-requests/${item!.id}`)
    await expect(buyerPage.getByRole('heading', { name: editedTitle })).toBeVisible()
    await expect(buyerPage.locator('.request-gallery-thumbs button')).toHaveCount(2)
    await expect(buyerPage.getByText('Ціна не вказана')).toBeVisible()
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyerPage.setViewportSize({ width, height: 900 })
      expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px overflow`).toBe(true)
      await expect(buyerPage.locator('.request-gallery-main')).toBeVisible()
    }
    const sellerPage = await seller.newPage()
    await sellerPage.goto('/requests')
    const sellerCard = sellerPage.getByRole('button', { name: `Відкрити запит: ${editedTitle}` })
    await expect(sellerCard).toBeVisible()
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await sellerPage.setViewportSize({ width, height: 900 })
      expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${width}px list overflow`).toBe(true)
      await expect(sellerCard).toBeVisible()
    }
    await sellerCard.click()
    await expect(sellerPage).toHaveURL(new RegExp(`/buy-requests/${item!.id}$`))
    await expect(sellerPage.getByRole('heading', { name: editedTitle })).toBeVisible()
    await expect(sellerPage.locator('.detail-market-header')).toHaveCount(0)
    await sellerPage.getByRole('button', { name: 'Запропонувати товар' }).click()
    const offerForm = sellerPage.locator('form.offer-form')
    await expect(offerForm).toBeVisible()
    await offerForm.getByLabel(/Ціна за/).fill('35')
    await offerForm.getByLabel('Умови отримання').fill('Самовивіз')
    await offerForm.getByRole('button', { name: 'Переглянути умови' }).click()
    await offerForm.getByRole('button', { name: 'Надіслати пропозицію' }).click()
    await expect(sellerPage.getByRole('button', { name: 'Запропонувати товар' })).toBeVisible()
    const strangerPage = await stranger.newPage()
    await strangerPage.goto(`/buy-requests/${item!.id}`)
    await expect(strangerPage.getByRole('heading', { name: editedTitle })).toBeVisible()
    await expect(strangerPage.getByRole('heading', { name: 'Пропозиції (1)' })).toHaveCount(0)
    const guestPage = await guest.newPage()
    await guestPage.goto(`/buy-requests/${item!.id}`)
    await expect(guestPage.getByRole('heading', { name: editedTitle })).toBeVisible()
    await expect(guestPage.getByRole('heading', { name: 'Пропозиції (1)' })).toHaveCount(0)
    await sellerPage.locator('.public-detail-page > .favorite-toggle').click()
    await expect(sellerPage.locator('.public-detail-page > .favorite-toggle')).toHaveAttribute('aria-pressed', 'true')
    await sellerPage.goto('/favorites')
    await sellerPage.getByRole('tab', { name: 'Запити' }).click()
    await expect(sellerPage.getByRole('button', { name: `Відкрити запит: ${editedTitle}` })).toBeVisible()
    await sellerPage.goBack()
    await expect(sellerPage.getByRole('heading', { name: editedTitle })).toBeVisible()
    await sellerPage.goForward()
    await sellerPage.getByRole('tab', { name: 'Запити' }).click()
    await expect(sellerPage.getByRole('button', { name: `Відкрити запит: ${editedTitle}` })).toBeVisible()
    await buyerPage.reload()
    await buyerPage.getByRole('button', { name: 'Обрати пропозицію' }).click()
    const select = buyerPage.getByRole('dialog', { name: 'Домовитися з продавцем?' })
    await select.getByRole('button', { name: 'Обрати і домовитися' }).click()
    await expect(select).toHaveCount(0)
    expect((await buyer.request.get('/api/orders')).status()).toBe(200)
  } finally {
    await Promise.allSettled([...actors, guest].map(context => context.close()))
    if (ids.length) {
      await db.connect()
      try {
        const files = await db.query<{ storage_key: string }>('SELECT storage_key FROM buy_request_photos WHERE buy_request_id IN (SELECT id FROM buy_requests WHERE buyer_id = ANY($1::uuid[]))', [ids])
        for (const file of files.rows) await unlink(join(process.cwd(), 'backend/uploads/buy-requests', file.storage_key)).catch(() => undefined)
        await db.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [ids])
        await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids])
      } finally { await db.end() }
    }
  }
})
