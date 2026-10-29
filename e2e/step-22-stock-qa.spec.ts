import { expect, test } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

async function account(name: string) {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${name}\n`)[1]?.split('\n## ')[0] || '';
  const username = block.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error('Missing local QA account');
  return { username, password };
}

test('sold product requires restocking before reactivation', async ({ browser }) => {
  test.setTimeout(720_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Local database required');
  const db = new pg.Client({ connectionString: databaseUrl });
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } });
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  let productId = '', requestId = '', nextRequestId = '', orderId = '';
  const title = `Step22 stock ${Date.now()}`;
  const evidence = 'docs/step22-stock-evidence';
  await mkdir(evidence, { recursive: true });
  try {
    await db.connect();
    expect((await seller.request.post('/api/auth/login', { data: await account('Hybrid') })).status()).toBe(200);
    expect((await buyer.request.post('/api/auth/login', { data: await account('Buyer A') })).status()).toBe(200);
    const categoryId = (await (await seller.request.get('/api/categories')).json()).categories.find((c: { code: string }) => c.code === 'grains').id;
    const location = { categoryId, settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin' };
    const product = await seller.request.post('/api/products', { data: { ...location, title, quantity: 5, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [] } });
    expect(product.status()).toBe(201); productId = (await product.json()).product.id;
    const newRequest = () => buyer.request.post('/api/buy-requests', { data: { ...location, title: title + ' request', description: '', quantity: 5, unit: 'kg', currency: 'UAH', minPrice: 0, maxPrice: 150, geoArea: 'Рівне', delivery: 'no', fulfillmentMode: 'multiple_sellers' } });
    const request = await newRequest(); expect(request.status()).toBe(201); requestId = (await request.json()).buyRequest.id;
    const offer = await seller.request.post(`/api/buy-requests/${requestId}/offers`, { data: { productId, quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' } });
    expect(offer.status()).toBe(201); const offerId = (await offer.json()).offer.id;
    const selected = await buyer.request.post(`/api/offers/${offerId}/accept`, { data: { quantity: 5, selectionKey: randomUUID() } });
    expect(selected.status()).toBe(201); orderId = (await selected.json()).order.id;
    expect((await seller.request.post(`/api/orders/${orderId}/seller-confirm`)).status()).toBe(200);
    expect((await buyer.request.post(`/api/orders/${orderId}/complete`, { data: { actualQuantity: 5 } })).status()).toBe(200);
    expect((await seller.request.post(`/api/orders/${orderId}/complete`)).status()).toBe(200);
    expect((await (await seller.request.get(`/api/products/${productId}`)).json()).product).toMatchObject({ status: 'sold', quantity: 0, availableQuantity: 0 });
    expect((await buyer.request.post(`/api/orders/${orderId}/reviews`, { data: { rating: 12 } })).status()).toBe(201);
    expect((await seller.request.post(`/api/orders/${orderId}/reviews`, { data: { rating: 10 } })).status()).toBe(201);
    const snapshot = async () => ({
      order: (await db.query('SELECT * FROM orders WHERE id=$1', [orderId])).rows,
      items: (await db.query('SELECT * FROM order_items WHERE order_id=$1 ORDER BY id', [orderId])).rows,
      reviews: (await db.query('SELECT * FROM reviews WHERE order_id=$1 ORDER BY id', [orderId])).rows,
      offers: (await db.query('SELECT * FROM offers WHERE buy_request_id=$1 ORDER BY id', [requestId])).rows,
    });
    const before = await snapshot();
    const denied = await seller.request.patch(`/api/products/${productId}`, { data: { status: 'active' } });
    expect(denied.status()).toBe(409);
    expect((await denied.json()).error).toBe('PRODUCT_NO_AVAILABLE_QUANTITY');
    expect((await (await buyer.request.get('/api/products', { params: { q: title } })).json()).products.some((item: { id: string }) => item.id === productId)).toBe(false);
    expect(JSON.stringify((await (await buyer.request.get('/api/map/markers', { params: { latitude: 50.6199, longitude: 26.2516, radiusKm: 50, q: title } })).json()).markers)).not.toContain(productId);
    const page = await seller.newPage(); page.setDefaultTimeout(45000);
    await page.goto('/my/products');
    const tabs = page.getByRole('navigation', { name: 'Стан активності' });
    await tabs.getByRole('button', { name: /^Неактивні/ }).click();
    const card = page.locator('.product-card').filter({ hasText: title });
    await card.getByRole('button', { name: 'Активувати' }).click();
    await expect(card.getByText('Щоб знову продавати товар, спочатку вкажіть доступну кількість')).toBeVisible();
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width);
      await card.screenshot({ path: `${evidence}/needs-stock-${width}.png` });
    }
    await card.getByRole('button', { name: 'Вказати кількість' }).click();
    await page.getByLabel('Кількість', { exact: true }).fill('5');
    await page.screenshot({ path: `${evidence}/edit-stock.png`, fullPage: true });
    await page.getByRole('button', { name: 'Зберегти зміни' }).click();
    await expect(page).toHaveURL(/\/my\/products$/);
    await tabs.getByRole('button', { name: /^Неактивні/ }).click();
    await card.getByRole('button', { name: 'Активувати' }).click();
    await tabs.getByRole('button', { name: /^Активні/ }).click();
    await expect(card).toContainText('Активне');
    await page.reload(); await tabs.getByRole('button', { name: /^Активні/ }).click(); await expect(card).toContainText('Активне');
    expect((await (await buyer.request.get('/api/products', { params: { q: title } })).json()).products.find((item: { id: string }) => item.id === productId)).toMatchObject({ availableQuantity: 5 });
    expect((await (await buyer.request.get('/api/map/markers', { params: { latitude: 50.6199, longitude: 26.2516, radiusKm: 50, q: title } })).json()).markers.find((item: { id: string }) => item.id === productId)).toMatchObject({ quantity: 5 });
    await page.goto('/map');
    await page.getByRole('searchbox', { name: /Пошук товару/ }).fill(title);
    await expect(page.getByRole('button', { name: `«${title}» ×` })).toBeVisible();
    await expect(page.locator('.map-summary h2')).toHaveText('1 товарів');
    await page.locator('.map-summary').screenshot({ path: `${evidence}/map-restocked.png` });
    const shopper = await buyer.newPage();
    await shopper.goto('/products');
    await shopper.getByRole('searchbox', { name: 'Пошук товару або продавця' }).fill(title);
    const found = shopper.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && new URL(r.url()).searchParams.get('q') === title);
    await shopper.getByRole('button', { name: 'Пошук', exact: true }).click(); await found;
    await expect(shopper.locator('.product-grid')).toContainText(title);
    await shopper.screenshot({ path: `${evidence}/search-restocked.png` });
    const next = await newRequest(); expect(next.status()).toBe(201); nextRequestId = (await next.json()).buyRequest.id;
    expect((await seller.request.post(`/api/buy-requests/${nextRequestId}/offers`, { data: { productId, quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' } })).status()).toBe(201);
    expect(await snapshot()).toEqual(before);
    await page.goto('/my/products');
    await tabs.getByRole('button', { name: /^Активні/ }).click(); await expect(card).toContainText('Активне');
    await page.screenshot({ path: `${evidence}/reactivated.png`, fullPage: true });
  } finally {
    await seller.close(); await buyer.close();
    if (orderId) await db.query('DELETE FROM orders WHERE id=$1', [orderId]);
    if (requestId) await db.query('DELETE FROM buy_requests WHERE id=$1', [requestId]);
    if (nextRequestId) await db.query('DELETE FROM buy_requests WHERE id=$1', [nextRequestId]);
    if (productId) await db.query('DELETE FROM products WHERE id=$1', [productId]);
    await db.end();
  }
});
