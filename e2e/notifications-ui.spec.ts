import { expect, test } from '@playwright/test'

// UI regression fixtures; these do not replace authenticated real-API scenarios.
for (const width of [1440, 1024, 768, 390, 320]) {
  test(`notification event text survives request previews at ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 })
    const requestId = '44444444-4444-4444-8444-444444444444'
    const productTitle = 'Мед із різнотрав’я з довгою назвою та додатковими побажаннями покупця'
    const description = 'Товар потрібен у герметичних харчових ємностях. '.repeat(6).slice(0, 280)
    const rejectionBody = 'Покупець відхилив вашу пропозицію. Причина: потрібна інша дата отримання. ' + 'Просимо узгодити умови наступної пропозиції заздалегідь. '.repeat(8)
    const preview = { title: productTitle, quantity: 12.5, unit: 'kg', minPrice: null, maxPrice: null, currency: 'UAH', receiptMethod: 'SELF_PICKUP', deliveryPreferred: false, deadline: '2026-12-01', publicPlace: 'Рівне, Рівненська область', description }
    const events = [
      { id: 'demand', type: 'system', title: 'Новий запит у категорії Мед', body: 'Перегляньте запит покупця.', context: 'selling', buyRequestPreview: preview },
      { id: 'offer', type: 'order', title: 'Нова пропозиція', body: 'Продавець відповів на ваш запит', context: 'buying', buyRequestPreview: null },
      { id: 'accepted', type: 'order', title: 'Вашу пропозицію обрали', body: 'Підтвердьте актуальність обраної кількості', context: 'selling', buyRequestPreview: preview },
      { id: 'rejected', type: 'order', title: 'Пропозицію відхилено', body: rejectionBody, context: 'selling', buyRequestPreview: preview },
      { id: 'cancelled', type: 'order', title: 'Домовленість скасовано', body: 'Кількість знову доступна для вибору пропозицій.', context: 'selling', buyRequestPreview: preview },
      { id: 'completed', type: 'order', title: 'Угоду підтверджено обома сторонами', body: '12.5 kg, 1800 UAH. Тепер можна залишити відгук.', context: 'selling', buyRequestPreview: preview },
      { id: 'deleted-request', type: 'order', title: 'Пропозицію відхилено', body: 'Покупець відхилив вашу пропозицію', context: 'selling', buyRequestPreview: null },
    ].map(item => ({ ...item, orderId: null, conversationId: null, buyRequestId: requestId, readAt: null as string | null, createdAt: '2026-10-08T10:00:00Z' }))
    await page.route('**/api/**', async route => {
      const path = new URL(route.request().url()).pathname
      if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'seller-fixture', username: 'QA' } } })
      if (path === '/api/categories') return route.fulfill({ json: { categories: [] } })
      if (path === '/api/profile/me') return route.fulfill({ json: { profile: { avatarUrl: null } } })
      if (path === '/api/conversations') return route.fulfill({ json: { conversations: [] } })
      if (path.startsWith('/api/products')) return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } })
      if (path === '/api/notifications') {
        const unread = events.filter(item => !item.readAt)
        return route.fulfill({ json: { notifications: events, unreadCounts: { total: unread.length, buying: unread.filter(item => item.context === 'buying').length, selling: unread.filter(item => item.context === 'selling').length } } })
      }
      if (path === '/api/notifications/read') {
        const id = route.request().postDataJSON().notificationId
        events.find(item => item.id === id)!.readAt = new Date().toISOString()
        return route.fulfill({ json: { ok: true } })
      }
      if (path === `/api/buy-requests/${requestId}`) return route.fulfill({ json: { buyRequest: { id: requestId, title: productTitle, description, category: { name: 'Мед' }, geoArea: 'Рівне', status: 'open', buyer: { id: 'buyer-fixture', username: 'Покупець QA' }, quantity: 12.5, unit: 'kg', fulfillmentMode: 'multiple_sellers', price: { min: null, max: null, currency: 'UAH' }, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', delivery: { required: false, preferred: 'no' } } } })
      if (path.endsWith('/offers')) return route.fulfill({ json: { offers: [] } })
      return route.fulfill({ json: {} })
    })
    await page.goto('/notifications')
    await page.getByRole('tab', { name: 'Усі', exact: true }).click()
    const rows = page.locator('.notification-row')
    await expect(rows).toHaveCount(events.length)
    for (const [index, event] of events.entries()) {
      const row = rows.nth(index)
      await expect(row.locator('.notification-event-title')).toHaveText(event.title)
      await expect(row.locator('.notification-event-title')).toBeVisible()
      await expect(row.locator('.notification-event-body')).toHaveText(event.body)
      await expect(row.locator('.notification-event-body')).toBeVisible()
      await expect(row.locator('small')).toContainText('Непрочитано')
      if (event.buyRequestPreview) {
        await expect(row.locator('.notification-request-preview > strong')).toHaveText(productTitle)
        await expect(row.getByText('12.5 кг', { exact: true })).toBeVisible()
        await expect(row.getByText('Не вказано', { exact: true })).toBeVisible()
        await expect(row.getByText('Самовивіз', { exact: true })).toBeVisible()
        await expect(row.getByText('01.12.2026', { exact: true })).toBeVisible()
        await expect(row.getByText(preview.publicPlace, { exact: true })).toBeVisible()
      } else await expect(row.locator('.notification-request-preview')).toHaveCount(0)
    }
    await page.getByRole('tab', { name: /^Продаж/ }).click()
    const rejected = page.locator('.notification-row').filter({ hasText: rejectionBody })
    const eventBox = await rejected.locator('.notification-event-body').boundingBox()
    const previewBox = await rejected.locator('.notification-request-preview').boundingBox()
    expect(eventBox!.y + eventBox!.height).toBeLessThanOrEqual(previewBox!.y)
    expect(await rejected.locator('.notification-event-body').evaluate(element => element.scrollHeight <= element.clientHeight + 1)).toBe(true)
    if (width < 1024) {
      await rejected.getByText('Короткий опис', { exact: true }).click()
      await expect(rejected.locator('.demand-notification-description p')).toHaveText(description)
      await expect(rejected.locator('.demand-notification-description p')).toBeVisible()
    } else await expect(rejected.locator('.demand-notification-description-desktop')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    for (const control of await rejected.locator('button').all()) {
      const box = await control.boundingBox()
      expect(box!.x).toBeGreaterThanOrEqual(0)
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 1)
    }
    await rejected.scrollIntoViewIfNeeded()
    await page.screenshot({ path: testInfo.outputPath(`notification-event-${width}.png`), fullPage: true })
    await rejected.getByRole('button', { name: 'Переглянути', exact: true }).click()
    await expect(page).toHaveURL(new RegExp(`/buy-requests/${requestId}$`))
    await expect(page.getByRole('heading', { name: productTitle, exact: true })).toBeVisible()
    await page.goto('/notifications')
    await page.getByRole('tab', { name: /^Продаж/ }).click()
    await expect(page.locator('.notification-row').filter({ hasText: rejectionBody }).locator('small')).toContainText('Прочитано')
    await expect(page.getByRole('tab', { name: /^Продаж/ })).toHaveText('Продаж 5')
  })
}

test('notification retry clears a failed read error after the list reloads', async ({ page }) => {
  let failRead = true
  const notification = { id: 'notification', type: 'system', title: 'Нова подія', body: 'Тестове сповіщення', context: 'buying', orderId: null, conversationId: null, buyRequestId: null, readAt: null, createdAt: new Date().toISOString() }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'viewer', username: 'QA' } } })
    if (path === '/api/categories') return route.fulfill({ json: { categories: [] } })
    if (path === '/api/profile/me') return route.fulfill({ json: { profile: { id: 'viewer', avatarUrl: null } } })
    if (path === '/api/conversations') return route.fulfill({ json: { conversations: [] } })
    if (path.startsWith('/api/products')) return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } })
    if (path === '/api/notifications' && method === 'GET') return route.fulfill({ json: { notifications: [notification], unreadCounts: { total: 1, buying: 1, selling: 0 } } })
    if (path === '/api/notifications/read' && method === 'PATCH') {
      if (failRead) return route.fulfill({ status: 503, json: { message: 'Тимчасова помилка' } })
      notification.readAt = new Date().toISOString()
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto('/notifications', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: /Купівля/ }).click()
  await page.getByRole('button', { name: 'Позначити прочитаним' }).click()
  await expect(page.getByRole('alert')).toContainText('Тимчасова помилка')

  failRead = false
  await page.getByRole('button', { name: 'Оновити список' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Прочитати всі' })).toBeEnabled()
})
