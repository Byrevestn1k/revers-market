import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { randomUUID } from 'node:crypto'

async function account(context: BrowserContext) {
    const suffix = randomUUID().replaceAll('-', '').slice(0, 8), username = `p2cat_${suffix}`
    const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } })
    expect(response.status()).toBe(201)
    const settlements = (await (await context.request.get('/api/settlements?q=Рівне')).json()).settlements
    const rivne = settlements.find((item: any) => item.name === 'Рівне' && item.region === 'Рівненська область')
    expect((await context.request.patch('/api/profile/me', { data: { location: 'Рівне', settlementCode: rivne.code, mapLocation: { mode: 'pin', latitude: 50.625951, longitude: 26.270642, consent: true } } })).status()).toBe(200)
    return { suffix, username }
}

async function chooseGrain(page: Page, grain: any) {
    const picker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' })
    await picker.fill(grain.name)
    const parent = page.getByRole('button', { name: `Вибрати категорію ${grain.name}` }).filter({ visible: true })
    if (await parent.count()) await parent.first().click()
    else await page.getByRole('option').filter({ hasText: grain.name }).filter({ visible: true }).first().click()
    await expect(page.locator('.category-picker input[type=hidden]')).toHaveValue(grain.id)
}

for (const width of [390, 1280]) for (const kind of ['product', 'request'] as const) test(`503 → 200 ${kind} at ${width}px without reload`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5182', viewport: { width, height: 900 } })
    const { suffix, username } = await account(context)
    const categoriesResponse = await context.request.get('/api/categories')
    const data = await categoriesResponse.json(), grain = data.categories.find((item: any) => item.code === 'grains')
    const page = await context.newPage(), errors: string[] = [], consoleErrors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && !(message.text().includes('503') && message.location().url.endsWith('/api/categories'))) consoleErrors.push(message.text()) })
    await page.addInitScript(() => { (window as any).__p2Document = crypto.randomUUID(); (window as any).__p2Rejections = []; window.addEventListener('unhandledrejection', event => (window as any).__p2Rejections.push(String(event.reason))) })
    let calls = 0, mode: 'fail' | 'hold' = 'fail', release: (() => void) | undefined
    await page.route('**/api/categories', async route => {
        calls++
        if (mode === 'fail') { await route.fulfill({ status: 503, json: { message: 'Тестова помилка' } }); return }
        await new Promise<void>(resolve => { release = resolve })
        await route.fulfill({ status: 200, json: data })
    })
    await page.goto(kind === 'product' ? '/my/products/new' : '/my/requests/new')
    await page.locator('.app-shell').waitFor({ state: 'attached' })
    const picker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' })
    await expect(page.getByText('Не вдалося завантажити категорії.')).toBeVisible()
    await expect(picker).toBeDisabled()
    const title = `Зерно ${kind} ${suffix}`
    await page.getByLabel('Назва товару').fill(title)
    const marker = await page.evaluate(() => (window as any).__p2Document)
    await page.screenshot({ path: `docs/qa/p1-category-selection/p2-${kind}-${width}-error.png` })
    const before = calls; mode = 'hold'
    await page.getByRole('button', { name: 'Повторити', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await expect(page.getByText('Завантажуємо категорії…')).toBeVisible()
    await expect.poll(() => calls).toBe(before + 1)
    await expect.poll(() => Boolean(release)).toBeTruthy()
    release!()
    await expect(picker).toBeEnabled()
    expect(await page.evaluate(() => (window as any).__p2Document)).toBe(marker)
    await expect(page.getByLabel('Назва товару')).toHaveValue(title)
    await chooseGrain(page, grain); await expect(page.getByLabel('Культура або сорт')).toBeVisible()
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]); expect(await page.evaluate(() => (window as any).__p2Rejections)).toEqual([])
    await page.getByLabel('Культура або сорт').fill('Пшениця')
    if (kind === 'product') await page.getByLabel('Ціна за одиницю').fill('100')
    await page.getByLabel('Можна домовитися', { exact: true }).check()
    await page.getByRole('button', { name: kind === 'product' ? 'Опублікувати товар' : 'Опублікувати запит' }).click()
    await expect(page).toHaveURL(kind === 'product' ? /\/my\/products$/ : /\/map$/)
    if (kind === 'product') {
        const products = (await (await context.request.get(`/api/products?ownerUsername=${username}`)).json()).products
        const product = products.find((item: any) => item.title === title)
        expect(product.category.id).toBe(grain.id); expect(product.attributes.grain_type).toBe('Пшениця')
        await page.goto(`/my/products/${product.id}/edit`)
        await expect(page.locator('.category-picker input[type=hidden]')).toHaveValue(grain.id)
        await expect(page.getByLabel('Культура або сорт')).toHaveValue('Пшениця')
    } else {
        const requests = (await (await context.request.get('/api/buy-requests?mine=true')).json()).buyRequests
        const item = requests.find((entry: any) => entry.title === title)
        expect(item.category.id).toBe(grain.id); expect(item.attributes.grain_type).toBe('Пшениця')
        await page.goto('/my/requests')
        await page.locator('.buy-request-card').filter({ hasText: title }).getByRole('button', { name: 'Редагувати', exact: true }).click()
        await expect(page.getByRole('dialog').locator('.category-picker input[type=hidden]')).toHaveValue(grain.id)
        await expect(page.getByRole('dialog').getByLabel('Культура або сорт')).toHaveValue('Пшениця')
    }
    expect(errors).toEqual([]); expect(await page.evaluate(() => (window as any).__p2Rejections)).toEqual([])
    await context.close()
})

test('persistent error, SPA reopen, empty response and slow retry', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5182', viewport: { width: 768, height: 900 } })
    await account(context)
    const data = await (await context.request.get('/api/categories')).json()
    const page = await context.newPage(), errors: string[] = [], consoleErrors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    page.on('console', message => { if (message.type() === 'error' && !(message.text().includes('503') && message.location().url.endsWith('/api/categories'))) consoleErrors.push(message.text()) })
    await page.addInitScript(() => { (window as any).__p2Document = crypto.randomUUID(); (window as any).__p2Rejections = []; window.addEventListener('unhandledrejection', event => (window as any).__p2Rejections.push(String(event.reason))) })
    let calls = 0, mode: 'fail' | 'empty' | 'hold' = 'fail', release: (() => void) | undefined
    await page.route('**/api/categories', async route => {
        calls++
        if (mode === 'fail') { await route.fulfill({ status: 503, json: { message: 'Тестова помилка' } }); return }
        if (mode === 'empty') { await route.fulfill({ status: 200, json: { categories: [] } }); return }
        await new Promise<void>(resolve => { release = resolve }); await route.fulfill({ status: 200, json: data })
    })
    await page.goto('/my/products/new'); await page.locator('.app-shell').waitFor({ state: 'attached' })
    await expect(page.getByText('Не вдалося завантажити категорії.')).toBeVisible()
    await page.waitForTimeout(500); const initial = calls
    await page.waitForTimeout(1200); expect(calls).toBe(initial)
    const marker = await page.evaluate(() => (window as any).__p2Document)
    await page.evaluate(() => { history.pushState({}, '', '/my/requests/new'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await expect(page.getByText('Не вдалося завантажити категорії.')).toBeVisible()
    await page.evaluate(() => { history.pushState({}, '', '/my/products/new'); window.dispatchEvent(new PopStateEvent('popstate')) })
    await expect.poll(() => calls).toBeGreaterThan(initial)
    await expect(page.getByText('Не вдалося завантажити категорії.')).toBeVisible()
    await page.waitForTimeout(500); const stable = calls
    await page.waitForTimeout(1200); expect(calls).toBe(stable)
    expect(await page.evaluate(() => (window as any).__p2Document)).toBe(marker)
    mode = 'empty'; await page.getByRole('button', { name: 'Повторити', exact: true }).click()
    await expect(page.getByText('Доступних категорій немає.')).toBeVisible()
    await expect(page.getByText('Завантажуємо категорії…')).toHaveCount(0)
    await page.screenshot({ path: 'docs/qa/p1-category-selection/p2-empty-768.png' })
    mode = 'hold'; const before = calls
    await page.getByRole('button', { name: 'Повторити', exact: true }).evaluate((button: HTMLButtonElement) => { button.click(); button.click() })
    await expect(page.getByText('Завантажуємо категорії…')).toBeVisible(); await expect.poll(() => calls).toBe(before + 1)
    await expect.poll(() => Boolean(release)).toBeTruthy(); release!()
    await expect(page.getByRole('combobox', { name: 'Пошук або вибір категорії' })).toBeEnabled()
    expect(await page.evaluate(() => (window as any).__p2Document)).toBe(marker)
    const picker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' })
    await picker.click()
    for (const name of ['Дитячий світ', 'Дитячий одяг', 'Одяг для хлопчиків']) {
        const menu = page.locator('.category-picker-menu'), box = await menu.boundingBox()
        expect(box && box.x >= 0 && box.x + box.width <= 768).toBeTruthy()
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy()
        if (name === 'Дитячий одяг') await page.screenshot({ path: 'docs/qa/p1-category-selection/p2-tree-768.png' })
        await page.locator('.category-picker-mobile-tree [role=option]').getByText(name, { exact: true }).first().click()
        if (name === 'Дитячий одяг') {
            await page.getByRole('button', { name: '← Назад' }).click()
            await page.locator('.category-picker-mobile-tree [role=option]').getByText(name, { exact: true }).first().click()
        }
    }
    await expect(picker).toHaveValue(/Одяг для хлопчиків/)
    expect(errors).toEqual([]); expect(consoleErrors).toEqual([]); expect(await page.evaluate(() => (window as any).__p2Rejections)).toEqual([])
    await context.close()
})

test('recommendations do not overwrite manual choice and attributes survive A → B → A', async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5182', viewport: { width: 768, height: 900 } })
    await account(context)
    const categories = (await (await context.request.get('/api/categories')).json()).categories
    const grain = categories.find((item: any) => item.code === 'grains')
    const phone = categories.find((item: any) => item.code === 'market-electronics--telefony-ta-aksesuary--smartfony-mobilni-telefony')
    const page = await context.newPage(), errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/my/products/new'); await page.locator('.app-shell').waitFor({ state: 'attached' })
    await page.getByLabel('Назва товару').fill('Смартфон Samsung 128 ГБ')
    const recommendation = page.locator('.category-recommendation button').filter({ hasText: 'Смартфони' }).first()
    await expect(recommendation).toBeVisible(); await chooseGrain(page, grain)
    await expect(page.locator('.category-picker input[type=hidden]')).toHaveValue(grain.id)
    await expect(recommendation).toBeVisible(); await recommendation.click()
    await expect(page.locator('.category-picker input[type=hidden]')).toHaveValue(phone.id)
    await page.getByLabel('Пам’ять (ГБ)').fill('128')
    page.once('dialog', dialog => dialog.accept()); await chooseGrain(page, grain)
    await expect(page.getByLabel('Культура або сорт')).toBeVisible()
    await recommendation.click()
    await expect(page.getByLabel('Пам’ять (ГБ)')).toHaveValue('128')
    await expect(page.getByLabel('Назва товару')).toHaveValue('Смартфон Samsung 128 ГБ')
    await page.screenshot({ path: 'docs/qa/p1-category-selection/p2-attributes-768.png' })
    expect(errors).toEqual([]); await context.close()
})
