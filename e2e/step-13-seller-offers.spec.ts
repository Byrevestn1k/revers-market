import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { Client } from 'pg'
import { unlink } from 'node:fs/promises'
import { join } from 'node:path'

const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64')
const image = `data:image/png;base64,${png.toString('base64')}`
const baseURL = 'http://127.0.0.1:5173'

test('three seller offer paths, comparison, acceptance and deal lifecycle through the real UI', async ({ browser }) => {
  test.setTimeout(360_000)
  const stamp = Date.now().toString(36)
  const contexts: BrowserContext[] = []
  const userIds: string[] = []
  const db = new Client({ connectionString: process.env.DATABASE_URL })
  let requestId = ''
  let productId = ''
  const actors: Page[] = []
  try {
    for (const [index, role] of ['buyer', 'seller_a', 'seller_b', 'seller_c'].entries()) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } })
      contexts.push(context)
      const username = `step13_${role}_${stamp}`
      const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${['50', '67', '68', '93'][index]}${String(Date.now()).slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
      expect(registered.status(), await registered.text()).toBe(201)
      userIds.push((await registered.json()).user.id)
      expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200)
      expect((await context.request.patch('/api/profile/me', { data: { location: 'Рівне', mapLocation: { mode: 'pin', latitude: 50.6199, longitude: 26.2516, consent: true } } })).status()).toBe(200)
      actors.push(await context.newPage())
    }
    const [buyer, sellerA, sellerB, sellerC] = actors
    const title = `Step 13 запит ${stamp}`
    await buyer.goto('/my/requests/new')
    await expect(buyer.getByRole('heading', { name: 'Створити запит на купівлю' })).toBeVisible()
    await buyer.getByLabel('Назва товару').fill(title)
    await buyer.getByRole('combobox', { name: 'Пошук або вибір категорії' }).click()
    await buyer.getByRole('option').first().click()
    await buyer.getByLabel('Кількість').fill('3')
    await buyer.getByLabel('Один продавець').check()
    await buyer.getByLabel('Спосіб отримання').selectOption('SELF_PICKUP')
    await buyer.getByRole('button', { name: 'Опублікувати запит' }).click()
    await expect(buyer).toHaveURL(/\/map$/)
    const ownRequests = (await (await contexts[0].request.get('/api/buy-requests', { params: { mine: 'true' } })).json()).buyRequests
    const created = ownRequests.find((item: { title: string }) => item.title === title)
    expect(created).toBeTruthy()
    requestId = created.id
    const productResponse = await contexts[1].request.post('/api/products', { data: { categoryId: created.category.id, title: `Товар Seller A ${stamp}`, description: 'Опис товару продавця A', quantity: 3, unit: created.unit, price: 120, currency: created.price.currency, deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [{ dataUrl: image, alt: 'Фото товару' }] } })
    expect(productResponse.status(), await productResponse.text()).toBe(201)
    productId = (await productResponse.json()).product.id
    const offerUrl = `/buy-requests/${requestId}`
    const openForm = async (page: Page) => { await page.goto(offerUrl); await page.getByRole('button', { name: 'Запропонувати товар' }).click(); return page.locator('form.seller-offer-form') }
    const send = async (form: ReturnType<Page['locator']>) => { await form.getByRole('button', { name: 'Переглянути умови' }).click(); await expect(form.getByText('Перевірте перед надсиланням')).toBeVisible(); await form.getByRole('button', { name: 'Надіслати пропозицію' }).click(); await expect(form).toHaveCount(0) }
    const productForm = await openForm(sellerA)
    await productForm.getByLabel('Свій товар').check()
    await productForm.getByLabel('Мій активний товар').selectOption(productId)
    await expect(productForm.locator('.photo-picker-item')).toHaveCount(1)
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await sellerA.setViewportSize({ width, height: 900 })
      expect(await sellerA.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `seller form overflow at ${width}`).toBe(true)
      await expect(productForm.getByRole('button', { name: 'Переглянути умови' })).toBeVisible()
      if (width <= 390) {
        await sellerA.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
        const action = await productForm.getByRole('button', { name: 'Переглянути умови' }).boundingBox()
        const nav = await sellerA.getByRole('navigation', { name: 'Основна навігація' }).boundingBox()
        expect(action && nav && action.y + action.height <= nav.y, `seller action above mobile navigation at ${width}`).toBe(true)
      }
    }
    await productForm.getByLabel('Коментар покупцю').fill('Пропозиція Seller A')
    await send(productForm)
    await sellerA.goto('/requests')
    const ownOffer = sellerA.locator('article.request-card').filter({ has: sellerA.getByRole('heading', { name: `Товар Seller A ${stamp}` }) })
    await ownOffer.getByRole('button', { name: 'Редагувати' }).click()
    const edit = sellerA.getByRole('dialog', { name: 'Редагувати пропозицію' })
    await edit.getByLabel('Короткий опис').fill('Опис тільки для цієї пропозиції')
    await edit.getByLabel('Додати фотографії').setInputFiles({ name: 'second.png', mimeType: 'image/png', buffer: png })
    await expect(edit.locator('.photo-picker-item')).toHaveCount(2)
    await edit.getByRole('button', { name: 'Перемістити фото 2 ліворуч' }).click()
    await edit.getByRole('button', { name: 'Зберегти пропозицію' }).click()
    await expect(edit).toHaveCount(0)
    const manualForm = await openForm(sellerB)
    await manualForm.getByLabel('Вручну').check()
    await manualForm.getByLabel('Назва товару').fill(`Інший товар ${stamp}`)
    await manualForm.getByLabel('Короткий опис').fill('Окремий товар без оголошення')
    await manualForm.getByLabel('Характеристики').fill('Сорт B')
    await manualForm.getByLabel(/Ціна за/).fill('130')
    await manualForm.getByLabel('Умови отримання').fill('Самовивіз')
    await manualForm.getByLabel('Додати фотографії').setInputFiles({ name: 'manual.png', mimeType: 'image/png', buffer: png })
    await sellerB.goto('/requests')
    await sellerB.goBack()
    await sellerB.getByRole('button', { name: 'Запропонувати товар' }).click()
    await expect(manualForm.getByLabel('Вручну')).toBeChecked()
    await expect(manualForm.getByLabel('Назва товару')).toHaveValue(`Інший товар ${stamp}`)
    await expect(manualForm.locator('.photo-picker-item')).toHaveCount(1)
    await send(manualForm)
    const termsForm = await openForm(sellerC)
    await expect(termsForm.getByLabel('Погодитися з умовами покупця')).toBeChecked()
    await termsForm.getByLabel(/Ціна за/).fill('140')
    await send(termsForm)
    await buyer.goto(offerUrl)
    await expect(buyer.getByRole('heading', { name: 'Пропозиції (3)' })).toBeVisible()
    const cards = buyer.locator('article.deal-offer')
    await expect(cards).toHaveCount(3)
    await cards.nth(1).getByText('Детальніше та інші дії').click()
    await expect(cards.nth(1).getByText('Порівняння умов')).toBeVisible()
    await expect(cards.nth(1).locator('.seller-offer-gallery img').first()).toBeVisible()
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyer.setViewportSize({ width, height: 900 })
      expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `buyer offers overflow at ${width}`).toBe(true)
      await expect(cards.first().getByRole('button', { name: 'Обрати пропозицію' })).toBeVisible()
    }
    const first = cards.filter({ hasText: `Товар Seller A ${stamp}` })
    await first.getByRole('button', { name: 'Обрати пропозицію' }).click()
    const selection = buyer.getByRole('dialog', { name: 'Домовитися з продавцем?' })
    await selection.getByRole('button', { name: 'Обрати і домовитися' }).click()
    await expect(selection).toHaveCount(0)
    await sellerA.goto('/orders')
    await sellerA.getByRole('button', { name: 'Підтвердити домовленість' }).click()
    await sellerA.getByRole('button', { name: '✔ Угода відбулася' }).click()
    await sellerA.getByRole('dialog', { name: 'Підтвердити результат угоди' }).getByRole('button', { name: 'Підтвердити' }).click()
    await buyer.goto('/orders')
    await buyer.getByRole('button', { name: '✔ Угода відбулася' }).click()
    await buyer.getByRole('dialog', { name: 'Підтвердити результат угоди' }).getByRole('button', { name: 'Підтвердити' }).click()
    await expect(buyer.getByRole('button', { name: 'Залишити відгук' }).first()).toBeVisible()
    await buyer.getByRole('button', { name: 'Залишити відгук' }).first().click()
    const review = buyer.getByRole('form', { name: /Відгук про продавця/ })
    for (const label of ['Загальна оцінка (1–12)', 'Спілкування (1–12)', 'Дотримання домовленостей (1–12)', 'Товар відповідав опису (1–12)']) await review.getByLabel(label).selectOption('10')
    await review.getByRole('button', { name: 'Залишити відгук' }).click()
    await buyer.goto('/notifications')
    await expect(buyer.getByRole('heading', { name: 'Сповіщення' })).toBeVisible()
    await buyer.getByRole('tab', { name: /Купівля/ }).click()
    await expect(buyer.locator('.notification-row').first()).toBeVisible()
    await sellerA.goto('/requests')
    await expect(sellerA.getByRole('heading', { name: `Товар Seller A ${stamp}` })).toBeVisible()
    const offerId = (await (await contexts[1].request.get('/api/offers/mine')).json()).offers.find((offer: { buyRequestId: string }) => offer.buyRequestId === requestId).id
    expect((await contexts[1].request.patch(`/api/offers/${offerId}`, { data: { title: 'Заборонена зміна' } })).status()).toBe(409)
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()))
    if (userIds.length) {
      await db.connect()
      try {
        const offerFiles = (await db.query('SELECT storage_key FROM offer_photos WHERE offer_id IN (SELECT id FROM offers WHERE seller_id = ANY($1::uuid[]))', [userIds])).rows.map(row => row.storage_key as string)
        const productFiles = (await db.query('SELECT storage_key FROM product_photos WHERE product_id IN (SELECT id FROM products WHERE owner_id = ANY($1::uuid[]))', [userIds])).rows.map(row => row.storage_key as string)
        await db.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [userIds])
        await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds])
        for (const [kind, files] of [['offers', offerFiles], ['products', productFiles]] as const) for (const key of files) if (key.includes('.') && !key.includes('..')) await unlink(join('backend/uploads', kind, key)).catch(() => undefined)
      } finally { await db.end() }
    }
  }
})
