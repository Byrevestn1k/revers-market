import { expect, test, type Browser, type BrowserContext } from '@playwright/test'
import { Client } from 'pg'

const password = 'StrongPassword1'
type Actor = { context: BrowserContext; id: string; username: string }

const register = async (browser: Browser, role: string, stamp: string): Promise<Actor> => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' })
  const username = `step9_${role}_${stamp}`
  const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Date.now()).slice(-6)}${role === 'owner' ? '1' : '2'}`, password, passwordConfirmation: password } })
  expect(response.status()).toBe(201)
  return { context, id: (await response.json() as { user: { id: string } }).user.id, username }
}

const cleanup = async (actors: Actor[]) => {
  await Promise.allSettled(actors.map(actor => actor.context.close()))
  const client = new Client({ connectionString: process.env.DATABASE_URL })
  await client.connect()
  try { await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [actors.map(actor => actor.id)]) } finally { await client.end() }
}

test('guest resumes a safe message intent in one canonical product chat and only opens the offer form', async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now().toString(36)
  const actors: Actor[] = []
  try {
    const owner = await register(browser, 'owner', stamp); actors.push(owner)
    const visitor = await register(browser, 'visitor', stamp); actors.push(visitor)
    const categories = await owner.context.request.get('/api/categories')
    const categoryId = (await categories.json() as { categories: Array<{ id: string }> }).categories[0].id
    const product = await owner.context.request.post('/api/products', { data: { categoryId, title: `Step 9 product ${stamp}`, description: 'Safe guest intent', quantity: 10, unit: 'kg', price: 20, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active' } })
    const buyRequest = await owner.context.request.post('/api/buy-requests', { data: { categoryId, title: `Step 9 request ${stamp}`, description: 'Safe guest offer intent', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 10, maxPrice: 20, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' } })
    expect(product.status()).toBe(201); expect(buyRequest.status()).toBe(201)
    const productId = (await product.json() as { product: { id: string } }).product.id
    const requestId = (await buyRequest.json() as { buyRequest: { id: string } }).buyRequest.id
    // A pre-existing conversation makes sure a direct URL is not replaced by the first item in the list after refresh.
    expect((await visitor.context.request.post(`/api/buy-requests/${requestId}/conversation`, { data: {} })).status()).toBe(201)

    const anonymous = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } })
    const page = await anonymous.newPage()
    await page.goto(`/products/${productId}`)
    await expect(page.getByRole('button', { name: /Написати продавцю/ })).toBeVisible()
    await page.getByRole('button', { name: /Написати продавцю/ }).click()
    await expect(page).toHaveURL(new RegExp(`/auth/login\\?return=.*products%2F${productId}.*intent%3Dmessage`))
    await page.getByRole('button', { name: 'Увійти', exact: true }).click()
    await page.getByLabel('Логін, електронна пошта').fill(visitor.username)
    await page.locator('input[name="password"]').fill(password)
    await page.getByRole('button', { name: 'Увійти в акаунт' }).click()
    await expect(page).toHaveURL(/\/messages\/[0-9a-f-]{36}$/)
    const conversationId = page.url().split('/').pop()!
    await page.reload()
    await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`))
    await page.goBack(); await expect(page).toHaveURL(new RegExp(`/products/${productId}$`))
    await page.goForward(); await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`))
    await page.goto(`/products/${productId}`)
    await page.getByRole('button', { name: /Написати продавцю/ }).click()
    await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`))

    await page.context().clearCookies()
    await page.goto(`/buy-requests/${requestId}`)
    await expect(page.getByRole('button', { name: 'Запропонувати товар' })).toBeVisible()
    await page.getByRole('button', { name: 'Запропонувати товар' }).click()
    await page.getByRole('button', { name: 'Увійти', exact: true }).click()
    await page.getByLabel('Логін, електронна пошта').fill(visitor.username)
    await page.locator('input[name="password"]').fill(password)
    await page.getByRole('button', { name: 'Увійти в акаунт' }).click()
    await expect(page).toHaveURL(new RegExp(`/buy-requests/${requestId}$`))
    await expect(page.getByRole('button', { name: 'Запропонувати' })).toBeVisible()
    await anonymous.close()
  } finally { await cleanup(actors) }
})

test('owner edits the same product from its public card through a reload-safe URL', async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now().toString(36)
  const actors: Actor[] = []
  try {
    const owner = await register(browser, 'product_editor', stamp); actors.push(owner)
    const outsider = await register(browser, 'product_outsider', stamp); actors.push(outsider)
    const categories = await owner.context.request.get('/api/categories')
    const categoryId = (await categories.json() as { categories: Array<{ id: string }> }).categories[0].id
    const settlements = await owner.context.request.get('/api/settlements', { params: { region: 'Рівненська область', limit: 1 } })
    const rivne = (await settlements.json() as { settlements: Array<{ code: string; name: string }> }).settlements[0]
    expect((await owner.context.request.patch('/api/profile/me', { data: { location: rivne.name, settlementCode: rivne.code, mapLocation: { mode: 'pin', latitude: 50.6199, longitude: 26.2516, consent: true } } })).status()).toBe(200)
    const page = await owner.context.newPage()
    await page.goto('/my/products/new')
    await expect(page.getByRole('heading', { name: 'Додати товар' })).toBeVisible()
    await page.getByLabel('Назва товару').fill(`Step 9 created ${stamp}`)
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).click()
    await page.getByRole('option').first().click()
    await page.getByLabel('Кількість').fill('3')
    await page.getByLabel('Ціна за одиницю').fill('25')
    await expect(page.getByText('✓ Точку для мапи визначено')).toBeVisible()
    await page.getByRole('button', { name: 'Опублікувати товар' }).click()
    await expect(page).toHaveURL(/\/my\/products$/)
    const mine = await owner.context.request.get('/api/products/mine', { params: { q: `Step 9 created ${stamp}` } })
    expect(mine.status()).toBe(200)
    expect((await mine.json() as { products: Array<{ title: string }> }).products.map(item => item.title)).toContain(`Step 9 created ${stamp}`)

    const created = await owner.context.request.post('/api/products', { data: {
      categoryId, title: `Step 9 editable ${stamp}`, description: 'Initial description remains after a one-field edit.',
      quantity: 7, unit: 'kg', price: 125, currency: 'UAH', deliveryMode: 'seller_delivery',
      geoZone: 'Рівне', status: 'active', photos: [
        { url: 'https://example.com/step9-first.jpg', alt: 'First QA photo' },
        { url: 'https://example.com/step9-second.jpg', alt: 'Second QA photo' },
      ],
    } })
    expect(created.status()).toBe(201)
    const original = (await created.json() as { product: { id: string } }).product

    await page.goto(`/products/${original.id}`)
    await page.getByRole('button', { name: 'Редагувати товар' }).click()
    await expect(page).toHaveURL(new RegExp(`/my/products/${original.id}/edit$`))
    await expect(page.getByRole('heading', { name: 'Редагувати товар' })).toBeVisible()
    await expect(page.getByLabel('Назва товару')).toHaveValue(`Step 9 editable ${stamp}`)
    await expect(page.getByLabel('Опис')).toHaveValue('Initial description remains after a one-field edit.')
    await expect(page.getByLabel('Кількість')).toHaveValue('7')
    await expect(page.getByLabel('Ціна за одиницю')).toHaveValue('125')
    await expect(page.getByLabel('Доставка')).toHaveValue('seller_delivery')
    await expect(page.locator('.photo-preview')).toHaveCount(2)

    await page.goBack(); await expect(page).toHaveURL(new RegExp(`/products/${original.id}$`))
    await page.goForward(); await expect(page).toHaveURL(new RegExp(`/my/products/${original.id}/edit$`))
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Редагувати товар' })).toBeVisible()
    await expect(page.getByLabel('Опис')).toHaveValue('Initial description remains after a one-field edit.')
    await expect(page.locator('.photo-preview')).toHaveCount(2)
    await page.getByLabel('Назва товару').fill(`Step 9 updated ${stamp}`)
    await page.getByRole('button', { name: 'Зберегти зміни' }).click()
    await expect(page).toHaveURL(/\/my\/products$/)
    const updated = await owner.context.request.get(`/api/products/${original.id}`)
    expect(updated.status()).toBe(200)
    expect((await updated.json()).product).toMatchObject({
      id: original.id, title: `Step 9 updated ${stamp}`, description: 'Initial description remains after a one-field edit.',
      quantity: 7, price: { amount: 125, currency: 'UAH' }, deliveryMode: 'seller_delivery', geoZone: 'Рівне',
    })
    expect((await owner.context.request.get(`/api/products/mine?q=${encodeURIComponent(stamp)}`)).status()).toBe(200)

    const outsiderPage = await outsider.context.newPage()
    await outsiderPage.goto(`/products/${original.id}`)
    await expect(outsiderPage.getByRole('button', { name: 'Редагувати товар' })).toHaveCount(0)
    await outsiderPage.goto(`/my/products/${original.id}/edit`)
    await expect(outsiderPage).toHaveURL(/\/my\/products$/)
  } finally { await cleanup(actors) }
})

test('region changes keep the product and request list aligned with map markers without exposing private coordinates', async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now().toString(36)
  const actors: Actor[] = []
  try {
    const seller = await register(browser, 'region_seller', stamp); actors.push(seller)
    const buyer = await register(browser, 'region_buyer', stamp); actors.push(buyer)
    const categories = await seller.context.request.get('/api/categories')
    const categoryId = (await categories.json() as { categories: Array<{ id: string }> }).categories[0].id
    const [rivneResponse, kyivResponse] = await Promise.all([
      seller.context.request.get('/api/settlements', { params: { region: 'Рівненська область', limit: 1 } }),
      seller.context.request.get('/api/settlements', { params: { region: 'Київська область', limit: 1 } }),
    ])
    const rivne = (await rivneResponse.json() as { settlements: Array<{ code: string; name: string }> }).settlements[0]
    const kyiv = (await kyivResponse.json() as { settlements: Array<{ code: string; name: string }> }).settlements[0]
    const privateRivneProductAddress = `Private product ${stamp}`
    const privateRivneRequestAddress = `Private request ${stamp}`
    const items = await Promise.all([
      seller.context.request.post('/api/products', { data: { categoryId, title: `Rivne product ${stamp}`, description: stamp, quantity: 10, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: rivne.name, settlementCode: rivne.code, address: privateRivneProductAddress, latitude: 50.619912, longitude: 26.251612, status: 'active' } }),
      seller.context.request.post('/api/products', { data: { categoryId, title: `Kyiv product ${stamp}`, description: stamp, quantity: 10, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: kyiv.name, settlementCode: kyiv.code, latitude: 50.450112, longitude: 30.523412, status: 'active' } }),
      buyer.context.request.post('/api/buy-requests', { data: { categoryId, title: `Rivne request ${stamp}`, description: stamp, quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 10, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: rivne.name, settlementCode: rivne.code, address: privateRivneRequestAddress, latitude: 50.679912, longitude: 26.301612, fulfillmentMode: 'multiple_sellers' } }),
      buyer.context.request.post('/api/buy-requests', { data: { categoryId, title: `Kyiv request ${stamp}`, description: stamp, quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 10, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: kyiv.name, settlementCode: kyiv.code, latitude: 50.500112, longitude: 30.573412, fulfillmentMode: 'multiple_sellers' } }),
    ])
    expect(items.map(item => item.status())).toEqual([201, 201, 201, 201])

    const page = await browser.newPage({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } })
    await page.goto('/map')
    const query = page.getByRole('searchbox', { name: /Пошук товару/ })
    await query.fill(stamp)
    const place = page.getByRole('combobox', { name: 'Населений пункт' })
    await place.click()
    await page.getByRole('option', { name: 'Рівненська область', exact: true }).click()
    await page.getByRole('button', { name: 'Вся область' }).click()
    const rivneMarkersResponse = page.waitForResponse(response => {
      const url = new URL(response.url())
      return url.pathname === '/api/map/markers' && url.searchParams.get('region') === 'Рівненська область' && url.searchParams.get('q') === stamp
    })
    await page.getByRole('button', { name: 'Знайти', exact: true }).click()
    const rivnePayload = await rivneMarkersResponse.then(response => response.json()) as { markers: Array<{ title: string; latitude: number; longitude: number }> }
    const resultEntries = page.locator('.map-result-list > .map-result, .map-result-list > .map-listing-result')
    await expect(resultEntries).toHaveCount(2)
    await expect(page.locator('.map-result-count')).toContainText('1 продавців · 1 запитів')
    await expect(page.locator('.map-result-list')).toContainText(`Rivne request ${stamp}`)
    await expect(page.locator('.map-result-list')).toContainText(seller.username)
    await expect(page.locator('.map-result-list')).not.toContainText(`Kyiv product ${stamp}`)
    await expect(page.locator('.map-result-list')).not.toContainText(`Kyiv request ${stamp}`)
    await expect(page.locator('.map-canvas .map-adaptive-wrap')).toHaveCount(2)
    expect(rivnePayload.markers).toHaveLength(2)
    expect(JSON.stringify(rivnePayload)).not.toContain(privateRivneProductAddress)
    expect(JSON.stringify(rivnePayload)).not.toContain(privateRivneRequestAddress)
    expect(rivnePayload.markers.find(item => item.title === `Rivne product ${stamp}`)).toMatchObject({ latitude: 50.62, longitude: 26.25 })
    expect(rivnePayload.markers.find(item => item.title === `Rivne request ${stamp}`)).toMatchObject({ latitude: 50.68, longitude: 26.3 })
    await page.locator('.map-result-list > button.map-result').click()
    await expect(page.locator('.map-result-list')).toContainText(`Rivne product ${stamp}`)
    await page.getByRole('button', { name: '← Усі результати' }).click()

    await place.click()
    await page.getByRole('option', { name: 'Київська область', exact: true }).click()
    await page.getByRole('button', { name: 'Вся область' }).click()
    await expect(resultEntries).toHaveCount(2)
    await expect(page.locator('.map-result-count')).toContainText('1 продавців · 1 запитів')
    await expect(page.locator('.map-result-list')).toContainText(`Kyiv request ${stamp}`)
    await expect(page.locator('.map-result-list')).toContainText(seller.username)
    await expect(page.locator('.map-result-list')).not.toContainText(`Rivne product ${stamp}`)
    await expect(page.locator('.map-result-list')).not.toContainText(`Rivne request ${stamp}`)

    await page.getByRole('button', { name: 'Скинути фільтри' }).click()
    await expect(query).toHaveValue('')
    await expect(page.getByRole('button', { name: /область ×/ })).toHaveCount(0)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Мапа поруч' })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Населений пункт' })).toHaveValue('Уся Україна')
    await page.close()
  } finally { await cleanup(actors) }
})

test('owner keeps private Product editor data after refresh and seller offer edits omit an unchanged Product link', async ({ browser }) => {
  test.setTimeout(120_000)
  const stamp = Date.now().toString(36)
  const actors: Actor[] = []
  try {
    const owner = await register(browser, 'private_editor', stamp); actors.push(owner)
    const buyer = await register(browser, 'offer_buyer', stamp); actors.push(buyer)
    const categories = await owner.context.request.get('/api/categories')
    const categoryId = (await categories.json() as { categories: Array<{ id: string }> }).categories[0].id
    const address = `Private editor address ${stamp}`
    const coordinates = { latitude: 50.619912, longitude: 26.251612 }
    const created = await owner.context.request.post('/api/products', { data: { categoryId, title: `Private editor Product ${stamp}`, description: 'Private location must survive a title-only save.', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', address, ...coordinates, addressVisibility: 'private', mapLocationMode: 'address', status: 'active' } })
    expect(created.status()).toBe(201)
    const productId = (await created.json() as { product: { id: string } }).product.id
    const page = await owner.context.newPage()
    const ownerGet = page.waitForResponse(response => response.url().endsWith(`/api/products/${productId}`) && response.request().method() === 'GET')
    await page.goto(`/my/products/${productId}/edit`)
    const ownerProduct = (await ownerGet).json() as Promise<{ product: { address: string | null; coordinates: { latitude: number; longitude: number } | null } }>
    await expect(page.getByRole('heading', { name: 'Редагувати товар' })).toBeVisible()
    await expect(page.getByLabel('Назва товару')).toHaveValue(`Private editor Product ${stamp}`)
    expect((await ownerProduct).product).toMatchObject({ address, coordinates })
    await page.getByLabel('Назва товару').fill(`Private editor updated ${stamp}`)
    await page.getByRole('button', { name: 'Зберегти зміни' }).click()
    await expect(page).toHaveURL(/\/my\/products$/)
    const afterTitleOnly = await owner.context.request.get(`/api/products/${productId}`)
    expect((await afterTitleOnly.json()).product).toMatchObject({ title: `Private editor updated ${stamp}`, address, coordinates })
    expect((await owner.context.request.patch(`/api/products/${productId}`, { data: { status: 'paused' } })).status()).toBe(200)
    await page.goto(`/my/products/${productId}/edit`)
    await page.reload()
    await expect(page.getByRole('heading', { name: 'Редагувати товар' })).toBeVisible()
    const paused = await owner.context.request.get(`/api/products/${productId}`)
    expect((await paused.json()).product).toMatchObject({ status: 'paused', address, coordinates })
    expect((await owner.context.request.patch(`/api/products/${productId}`, { data: { status: 'sold' } })).status()).toBe(200)
    await page.goto(`/my/products/${productId}/edit`)
    await expect(page.getByRole('heading', { name: 'Редагувати товар' })).toBeVisible()

    const requestResult = await buyer.context.request.post('/api/buy-requests', { data: { categoryId, title: `Offer request ${stamp}`, description: '', quantity: 5, unit: 'kg', currency: 'UAH', minPrice: 90, maxPrice: 110, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: 'Рівне', fulfillmentMode: 'multiple_sellers' } })
    expect(requestResult.status()).toBe(201)
    const requestId = (await requestResult.json() as { buyRequest: { id: string } }).buyRequest.id
    const available = await owner.context.request.post('/api/products', { data: { categoryId, title: `Offer product ${stamp}`, description: '', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active' } })
    const offerProductId = (await available.json() as { product: { id: string } }).product.id
    const offerResult = await owner.context.request.post(`/api/buy-requests/${requestId}/offers`, { data: { productId: offerProductId, quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз', note: 'Original note' } })
    expect(offerResult.status()).toBe(201)
    const offerId = (await offerResult.json() as { offer: { id: string } }).offer.id
    expect((await owner.context.request.patch(`/api/products/${offerProductId}`, { data: { status: 'paused' } })).status()).toBe(200)
    await page.goto('/requests')
    const offerCard = page.getByRole('article').filter({ hasText: 'Моя пропозиція на запит' }).filter({ hasText: `Offer request ${stamp}` })
    await expect(offerCard).toBeVisible()
    await offerCard.getByRole('button', { name: 'Редагувати', exact: true }).click()
    await page.locator('textarea[name="note"]').fill('Updated note without relinking')
    const patchRequest = page.waitForRequest(request => request.url().endsWith(`/api/offers/${offerId}`) && request.method() === 'PATCH')
    await page.getByRole('button', { name: 'Зберегти пропозицію' }).click()
    const sent = JSON.parse((await patchRequest).postData() ?? '{}') as Record<string, unknown>
    expect(sent).toEqual({ note: 'Updated note without relinking' })
    await expect(page.getByText('Пропозицію оновлено')).toBeVisible()
    const ownOffers = await owner.context.request.get('/api/offers/mine')
    expect((await ownOffers.json() as { offers: Array<{ id: string; note: string; existingProduct: { id: string } | null }> }).offers.find(item => item.id === offerId)).toMatchObject({ note: 'Updated note without relinking', existingProduct: { id: offerProductId } })
    await page.close()
  } finally { await cleanup(actors) }
})
