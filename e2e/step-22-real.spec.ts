import { test, expect } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import pg from 'pg';

async function account(name: string) {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${name}\n`)[1]?.split('\n## ')[0] || '';
  const username = block.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error('Missing local QA account');
  return { username, password };
}

test('Step 22 with local PostgreSQL and real API', async ({ browser }) => {
  test.setTimeout(720_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Local database required');
  const db = new pg.Client({ connectionString: databaseUrl });
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } });
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const ids: { product?: string; draft?: string; request?: string } = {};
  const title = `Step22 QA ${Date.now()}`;
  const evidence = 'docs/step22-evidence';
  await mkdir(evidence, { recursive: true });
  try {
    await db.connect();
    expect((await seller.request.post('/api/auth/login', { data: await account('Hybrid') })).status()).toBe(200);
    expect((await buyer.request.post('/api/auth/login', { data: await account('Buyer A') })).status()).toBe(200);
    const categories = (await (await seller.request.get('/api/categories')).json()).categories;
    const categoryId = categories.find((c: { code: string }) => c.code === 'grains').id;
    const location = { categoryId, settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin' };
    const productData = { ...location, title, quantity: 2, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', photos: [] };
    const created = await seller.request.post('/api/products', { data: { ...productData, status: 'active' } });
    expect(created.status()).toBe(201); ids.product = (await created.json()).product.id;
    const draft = await seller.request.post('/api/products', { data: { ...productData, title: title + ' draft', status: 'draft' } });
    expect(draft.status()).toBe(201); ids.draft = (await draft.json()).product.id;
    const buyRequest = await seller.request.post('/api/buy-requests', { data: { ...location, title: title + ' request', description: '', quantity: 2, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', receiptMethod: 'SELF_PICKUP', fulfillmentMode: 'single_seller', photos: [] } });
    expect(buyRequest.status()).toBe(201); ids.request = (await buyRequest.json()).buyRequest.id;
    expect((await buyer.request.get(`/api/products/${ids.draft}`)).status()).toBe(404);
    const draftSearch = await (await buyer.request.get('/api/products', { params: { q: title + ' draft' } })).json();
    expect(draftSearch.products.some((p: { id: string }) => p.id === ids.draft)).toBe(false);
    const draftMap = await (await buyer.request.get('/api/map/markers', { params: { latitude: 50.6199, longitude: 26.2516, radiusKm: 50, q: title + ' draft' } })).json();
    expect(JSON.stringify(draftMap.markers)).not.toContain(ids.draft);
    expect((await buyer.request.put('/api/favorites', { data: { targetType: 'product', targetId: ids.product } })).status()).toBe(200);
    const activeSearch = await (await buyer.request.get('/api/products', { params: { q: title } })).json();
    expect(activeSearch.products.some((p: { id: string }) => p.id === ids.product)).toBe(true);
    const activeMarkers = await (await buyer.request.get('/api/map/markers', { params: { latitude: 50.6199, longitude: 26.2516, radiusKm: 50, q: title } })).json();
    expect(JSON.stringify(activeMarkers.markers)).toContain(ids.product);
    const clusterParams = { latitude: 50.6199, longitude: 26.2516, nationwide: 'true', geoLevel: 'region', q: title, categoryId };
    const activeGroups = await (await buyer.request.get('/api/map/markers', { params: clusterParams })).json();
    expect(activeGroups.total).toBe(2);
    const page = await seller.newPage(); page.setDefaultTimeout(45000);
    const buyerPage = await buyer.newPage(); buyerPage.setDefaultTimeout(45000);
    await buyerPage.goto('/products');
    await buyerPage.getByRole('searchbox', { name: 'Пошук товару або продавця' }).fill(title);
    const activeResult = buyerPage.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && new URL(r.url()).searchParams.get('q') === title);
    await buyerPage.getByRole('button', { name: 'Пошук', exact: true }).click(); await activeResult;
    await expect(buyerPage.locator('.product-grid')).toContainText(title);
    await buyerPage.screenshot({ path: `${evidence}/search-active.png` });
    await buyerPage.goto('/favorites');
    await expect(buyerPage.locator('.product-card').filter({ hasText: title })).toContainText('Активне');
    await buyerPage.screenshot({ path: `${evidence}/favorite-active.png` });
    await page.goto('/map');
    await page.getByRole('searchbox', { name: /Пошук товару/ }).fill(title);
    await expect(page.getByRole('button', { name: `«${title}» ×` })).toBeVisible();
    await expect(page.locator('.map-summary')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.map-summary h2')).toHaveText('1 товарів');
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await expect(page.locator('.map-summary')).toHaveAttribute('aria-busy', 'false');
      await expect(page.locator('.map-summary h2')).toHaveText('1 товарів');
      await expect(page.getByText('Оновлюємо результати…')).toHaveCount(0);
      await page.locator('.map-summary').screenshot({ path: `${evidence}/map-results-${width}.png` });
      await page.screenshot({ path: `${evidence}/map-active-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/my/products');
    const tabs = page.getByRole('navigation', { name: 'Стан активності' });
    const allProducts: { status: string }[] = [];
    for (let n = 1, pages = 1; n <= pages; n++) {
      const response = await (await seller.request.get('/api/products/mine', { params: { page: n, limit: 50 } })).json();
      allProducts.push(...response.products); pages = response.pagination.pages;
    }
    await expect(tabs.getByRole('button', { name: `Активні ${allProducts.filter(p => p.status === 'active').length}`, exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: `Чернетки ${allProducts.filter(p => p.status === 'draft').length}`, exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: `Неактивні ${allProducts.filter(p => !['active', 'draft'].includes(p.status)).length}`, exact: true })).toBeVisible();
    await tabs.getByRole('button', { name: /^Активні/ }).click();
    const card = page.locator('.product-card').filter({ hasText: title }).filter({ hasNotText: 'draft' });
    await expect(card).toHaveCount(1); await expect(card).toContainText('Активне');
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      const cardBox = await card.boundingBox();
      const menuBox = await card.getByRole('combobox', { name: 'Інші дії' }).boundingBox();
      expect(menuBox!.x).toBeGreaterThanOrEqual(cardBox!.x);
      expect(menuBox!.x + menuBox!.width).toBeLessThanOrEqual(cardBox!.x + cardBox!.width);
      await expect(tabs).toBeVisible(); await page.screenshot({ path: `${evidence}/products-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await card.getByRole('button', { name: 'Зробити неактивним' }).click();
    await tabs.getByRole('button', { name: /^Неактивні/ }).click();
    await expect(card).toContainText('Неактивне');
    await page.reload(); await tabs.getByRole('button', { name: /^Неактивні/ }).click(); await expect(card).toBeVisible();
    const search = await (await buyer.request.get('/api/products', { params: { q: title } })).json();
    expect(search.products.some((p: { id: string }) => p.id === ids.product)).toBe(false);
    const markers = await (await buyer.request.get('/api/map/markers', { params: { latitude: 50.6199, longitude: 26.2516, radiusKm: 50, q: title } })).json();
    expect(JSON.stringify(markers.markers)).not.toContain(ids.product);
    const inactiveGroups = await (await buyer.request.get('/api/map/markers', { params: clusterParams })).json();
    expect(inactiveGroups.total).toBe(1);
    expect((await buyer.request.get(`/api/products/${ids.product}`)).status()).toBe(404);
    await page.goto('/map');
    await page.getByRole('searchbox', { name: /Пошук товару/ }).fill(title);
    await expect(page.getByRole('button', { name: `«${title}» ×` })).toBeVisible();
    await expect(page.locator('.map-summary')).toHaveAttribute('aria-busy', 'false');
    await expect(page.locator('.map-summary h2')).toHaveText('0 товарів');
    await page.screenshot({ path: `${evidence}/map-inactive.png` });
    await page.goto('/my/products'); await tabs.getByRole('button', { name: /^Неактивні/ }).click();
    await buyerPage.goto('/products');
    await buyerPage.getByRole('searchbox', { name: 'Пошук товару або продавця' }).fill(title);
    const inactiveResult = buyerPage.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && new URL(r.url()).searchParams.get('q') === title);
    await buyerPage.getByRole('button', { name: 'Пошук', exact: true }).click(); await inactiveResult;
    await expect(buyerPage.locator('.product-grid').getByText(title, { exact: true })).toHaveCount(0);
    await expect(buyerPage.getByText('Нічого не знайдено')).toBeVisible();
    await buyerPage.screenshot({ path: `${evidence}/search-inactive.png` });
    await buyerPage.goto('/favorites');
    const saved = buyerPage.locator('article').filter({ hasText: title }); await expect(saved).toContainText('Неактивне');
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyerPage.setViewportSize({ width, height: 900 });
      expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await buyerPage.screenshot({ path: `${evidence}/favorite-inactive-${width}.png` });
    }
    await saved.getByRole('button', { name: 'Видалити з обраного' }).click(); await expect(saved).toHaveCount(0);
    await card.getByRole('button', { name: 'Активувати' }).click();
    await tabs.getByRole('button', { name: /^Активні/ }).click(); await expect(card).toContainText('Активне');
    await card.getByRole('combobox', { name: 'Інші дії' }).selectOption('sold');
    await tabs.getByRole('button', { name: /^Неактивні/ }).click(); await expect(card).toContainText('Неактивне');
    await card.getByRole('button', { name: 'Активувати' }).click();
    await tabs.getByRole('button', { name: /^Активні/ }).click(); await expect(card).toContainText('Активне');
    await page.goto('/my/requests');
    const requestTabs = page.getByRole('navigation', { name: 'Стан активності' });
    const allRequests: { status: string }[] = [];
    for (let n = 1, pages = 1; n <= pages; n++) {
      const response = await (await seller.request.get('/api/buy-requests', { params: { mine: 'true', page: n, limit: 50 } })).json();
      allRequests.push(...response.buyRequests); pages = response.pagination.pages;
    }
    const activeStatuses = ['open', 'partially_selected', 'partially_completed', 'partially_fulfilled'];
    await expect(requestTabs.getByRole('button', { name: `Активні ${allRequests.filter(r => activeStatuses.includes(r.status)).length}`, exact: true })).toBeVisible();
    await expect(requestTabs.getByRole('button', { name: `Неактивні ${allRequests.filter(r => !activeStatuses.includes(r.status)).length}`, exact: true })).toBeVisible();
    await requestTabs.getByRole('button', { name: /^Активні/ }).click();
    await expect(page.locator('.buy-request-card').filter({ hasText: title + ' request' })).toContainText('Активне');
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await page.screenshot({ path: `${evidence}/requests-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    const requestCard = page.locator('.buy-request-card').filter({ hasText: title + ' request' });
    await requestCard.getByRole('button', { name: 'Закрити запит' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Закрити запит' }).click();
    await requestTabs.getByRole('button', { name: /^Неактивні/ }).click();
    await expect(requestCard).toContainText('Неактивне');
    await page.reload(); await requestTabs.getByRole('button', { name: /^Неактивні/ }).click(); await expect(requestCard).toBeVisible();
    await expect(requestCard.getByRole('button', { name: 'Редагувати' })).toHaveCount(0);
    expect((await buyer.request.get(`/api/buy-requests/${ids.request}`)).status()).toBe(404);
    expect((await seller.request.patch(`/api/buy-requests/${ids.request}`, { data: { status: 'open' } })).status()).toBe(409);
    expect((await buyer.request.post(`/api/buy-requests/${ids.request}/offers`, { data: { quantity: 2, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' } })).status()).toBe(409);
    await page.screenshot({ path: `${evidence}/request-inactive.png` });
    const closedRequests = await (await buyer.request.get('/api/buy-requests', { params: { q: title } })).json();
    expect(closedRequests.buyRequests.some((r: { id: string }) => r.id === ids.request)).toBe(false);
    const closedMap = await (await buyer.request.get('/api/map/markers', { params: { latitude: 50.6199, longitude: 26.2516, radiusKm: 50, q: title } })).json();
    expect(JSON.stringify(closedMap.markers)).not.toContain(ids.request);
    console.log('STEP22_REAL_UI_PASS: product deactivate/reactivate/reload/sold-reactivate; favorite removal; draft and direct access; request active; responsive product tabs');
  } finally {
    await seller.close(); await buyer.close();
    if (ids.request) await db.query('DELETE FROM buy_requests WHERE id=$1', [ids.request]);
    if (ids.product) await db.query('DELETE FROM products WHERE id=$1', [ids.product]);
    if (ids.draft) await db.query('DELETE FROM products WHERE id=$1', [ids.draft]);
    await db.end();
  }
});
