import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const accounts = existsSync('docs/TEST_ACCOUNTS.local.md') ? readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8').replace(/\r\n/g, '\n') : '';
test.skip(!accounts, 'Local QA accounts are required.');
const hybrid = accounts.split('## Hybrid\n')[1]?.split('\n## ')[0] ?? '';
const username = hybrid.match(/Username: (.+)/)?.[1].trim() ?? '';
const password = hybrid.match(/Password: (.+)/)?.[1].trim() ?? '';
const credentials = (section: string) => {
  const block = accounts.split(`## ${section}\n`)[1]?.split('\n## ')[0] ?? '';
  return { username: block.match(/Username: (.+)/)?.[1].trim(), password: block.match(/Password: (.+)/)?.[1].trim() };
};

for (const width of [320, 390, 430, 768, 1024, 1280, 1440]) {
  test(`independent Step 17 form and map review at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ viewport: { width, height: 800 } });
    try {
      expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200);
      const page = await context.newPage();
      await page.goto('/discover');
      await expect(page.locator('.map-canvas.leaflet-container')).toBeVisible();
      if (width <= 760) {
        await page.locator('.mobile-nav').getByRole('button', { name: /Знайти/ }).click();
        await expect.poll(() => page.locator('.map-canvas').evaluate(element => {
          const map = element.getBoundingClientRect();
          const header = document.querySelector('.mobile-topbar')?.getBoundingClientRect().bottom ?? 0;
          return map.top >= header - 2 && map.top < innerHeight / 2;
        })).toBe(true);
        await page.locator('.mobile-nav').getByRole('button', { name: /Кабінет/ }).click();
        await page.goBack();
        await expect(page).toHaveURL(/\/discover$/);
        await expect(page.locator('.map-canvas.leaflet-container')).toBeVisible();
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

      await page.goto('/my/requests/new');
      await expect(page.getByRole('checkbox', { name: 'Можна придбати частинами у різних продавців' })).not.toBeChecked();
      await expect(page.locator('select[name="currency"]')).toContainText('USD');
      await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).click();
      const tree = width <= 760 ? page.locator('.category-picker-mobile-tree') : page.locator('.category-picker-desktop-tree');
      await tree.getByRole('option', { name: /Авто/ }).first().click();
      await expect(tree.getByRole('option').first()).toBeVisible();
      const delivery = page.getByRole('checkbox', { name: 'Можна домовитися' });
      await delivery.check();
      await expect(delivery).toBeChecked();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);

      await page.goto('/my/products/new');
      await expect(page.locator('select[name="currency"]')).toContainText('USD');
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
    } finally {
      await context.close();
    }
  });
}

test('independent Step 17 one and multiple seller flows in the browser', async ({ browser }) => {
  test.setTimeout(180000);
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 800 } });
  const sellerA = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const sellerB = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const requestIds: string[] = [];
  try {
    for (const [context, section] of [[buyer, 'Buyer A'], [sellerA, 'Seller A'], [sellerB, 'Seller B']] as const) {
      expect((await context.request.post('/api/auth/login', { data: credentials(section) })).status()).toBe(200);
    }
    const category = (await (await buyer.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const suffix = Date.now();
    const makeRequest = async (mode: 'single_seller' | 'multiple_sellers') => {
      const response = await buyer.request.post('/api/buy-requests', { data: { categoryId: category.id, title: `Review ${mode} ${suffix}`, description: '', quantity: 20, unit: 'kg', currency: 'USD', minPrice: 100, maxPrice: 100, geoArea: 'Рівне', fulfillmentMode: mode } });
      expect(response.status()).toBe(201);
      const id = (await response.json()).buyRequest.id as string;
      requestIds.push(id);
      return id;
    };
    const makeOffer = async (id: string, context: typeof sellerA, quantity: number) => {
      const response = await context.request.post(`/api/buy-requests/${id}/offers`, { data: { quantity, unit: 'kg', price: 100, currency: 'USD', delivery: 'Самовивіз' } });
      expect(response.status()).toBe(201);
    };
    const page = await buyer.newPage();
    const choose = async (sellerName: string) => {
      const offer = page.locator('article.deal-offer').filter({ hasText: sellerName });
      await offer.getByRole('button', { name: 'Обрати пропозицію' }).click();
      await expect(page.getByRole('button', { name: 'Обрати і домовитися' })).toBeEnabled();
      await page.getByRole('button', { name: 'Обрати і домовитися' }).click();
      await expect(page.getByRole('button', { name: 'Обрати і домовитися' })).toHaveCount(0);
    };

    const single = await makeRequest('single_seller');
    await makeOffer(single, sellerA, 8);
    await makeOffer(single, sellerB, 12);
    await page.goto(`/buy-requests/${single}`);
    await expect(page.locator('article.deal-offer')).toHaveCount(2);
    await choose(credentials('Seller A').username);
    await expect(page.locator('article.deal-offer').filter({ hasText: credentials('Seller B').username }).getByRole('button', { name: 'Обрати пропозицію' })).toBeDisabled();
    await expect(page.locator('.request-progress')).toContainText('Ще потрібно: 12');

    const multiple = await makeRequest('multiple_sellers');
    await makeOffer(multiple, sellerA, 8);
    await makeOffer(multiple, sellerB, 12);
    await page.goto(`/buy-requests/${multiple}`);
    await expect(page.locator('article.deal-offer')).toHaveCount(2);
    await choose(credentials('Seller A').username);
    await choose(credentials('Seller B').username);
    await expect(page.locator('.request-progress')).toContainText('Ще потрібно: 0');
    const rows = await buyer.request.get(`/api/buy-requests/${multiple}`);
    expect((await rows.json()).buyRequest).toMatchObject({ selectedQuantity: 20, remainingQuantity: 0 });
  } finally {
    await Promise.allSettled([buyer.close(), sellerA.close(), sellerB.close()]);
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      for (const id of requestIds) {
        await db.query('DELETE FROM orders WHERE buy_request_id = $1', [id]);
        await db.query('DELETE FROM buy_requests WHERE id = $1', [id]);
      }
    } finally { await db.end(); }
  }
});

test('independent Step 17 marker selection survives pan and zoom', async ({ browser }) => {
  test.setTimeout(120000);
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 800 } });
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  let productId = '';
  try {
    expect((await buyer.request.post('/api/auth/login', { data: credentials('Buyer A') })).status()).toBe(200);
    expect((await seller.request.post('/api/auth/login', { data: credentials('Seller A') })).status()).toBe(200);
    const category = (await (await seller.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const title = `Review Marker ${Date.now()}`;
    const created = await seller.request.post('/api/products', { data: { categoryId: category.id, title, description: '', quantity: 2, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', geoZone: 'Рівне', latitude: 50.6199, longitude: 26.2516, status: 'active', photos: [] } });
    expect(created.status()).toBe(201);
    productId = (await created.json()).product.id;
    const favoritesBefore = JSON.stringify(await (await buyer.request.get('/api/favorites')).json());
    const page = await buyer.newPage();
    await page.goto('/discover');
    await page.locator('.map-search-main input').fill(title);
    await page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click();
    await expect(page.locator('.map-pin[data-kind="product"]').first()).toBeVisible();
    await page.locator('.map-pin[data-kind="product"]').first().click();
    await expect(page.locator('.map-listing-preview')).toContainText(title);
    await expect(page.locator('.map-pin-selected')).toHaveCount(1);
    await page.locator('.leaflet-control-zoom-out').click();
    await expect(page.locator('.map-listing-preview')).toContainText(title);
    const map = page.locator('.map-canvas');
    const box = await map.boundingBox();
    expect(box).toBeTruthy();
    await page.mouse.move(box!.x + 90, box!.y + 130);
    await page.mouse.down();
    await page.mouse.move(box!.x + 115, box!.y + 140, { steps: 5 });
    await page.mouse.up();
    await expect(page.locator('.map-listing-preview')).toContainText(title);
    await map.click({ position: { x: 100, y: 180 } });
    await expect(page.locator('.map-pin-selected')).toHaveCount(0);
    expect(JSON.stringify(await (await buyer.request.get('/api/favorites')).json())).toBe(favoritesBefore);
  } finally {
    await Promise.allSettled([buyer.close(), seller.close()]);
    if (productId) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try { await db.query('DELETE FROM products WHERE id = $1', [productId]); }
      finally { await db.end(); }
    }
  }
});

test('independent Step 17 cluster click keeps its selected results', async ({ browser }) => {
  test.setTimeout(120000);
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 800 }, hasTouch: true });
  const ids: string[] = [];
  try {
    expect((await context.request.post('/api/auth/login', { data: credentials('Seller A') })).status()).toBe(200);
    const category = (await (await context.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const query = `Review Cluster ${Date.now()}`;
    for (const suffix of ['A', 'B', 'C', 'D', 'E']) {
      const created = await context.request.post('/api/products', { data: { categoryId: category.id, title: `${query} ${suffix}`, description: '', quantity: 2, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', geoZone: 'Рівне', latitude: 50.6199, longitude: 26.2516, status: 'active', photos: [] } });
      expect(created.status()).toBe(201);
      ids.push((await created.json()).product.id);
    }
    const page = await context.newPage();
    await page.goto('/discover');
    await page.locator('.map-search-main input').fill(query);
    await page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click();
    const cluster = page.locator('.map-pin[data-kind="cluster"]').first();
    await expect(cluster).toBeVisible();
    await cluster.click();
    await expect(page.locator('.map-summary-heading')).toContainText('Обрана точка');
    await expect(page.locator('.map-result-list .map-listing-result')).toHaveCount(5);
    const panel = page.locator('.map-summary');
    await expect(page.getByRole('button', { name: 'Прокрутити картки вгору' })).toHaveCount(0);
    const down = page.getByRole('button', { name: 'Прокрутити картки вниз' });
    await expect(down).toBeVisible();
    const before = await panel.evaluate(element => element.scrollTop);
    await down.click();
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(before);
    await expect(page.getByRole('button', { name: 'Прокрутити картки вгору' })).toBeVisible();
    const afterArrow = await panel.evaluate(element => element.scrollTop);
    const bounds = await panel.boundingBox();
    expect(bounds).toBeTruthy();
    const touch = await context.newCDPSession(page);
    const x = bounds!.x + bounds!.width / 2;
    const y = bounds!.y + bounds!.height * .75;
    await touch.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
    for (let step = 1; step <= 5; step++) {
      await touch.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - step * 30 }] });
    }
    await touch.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
    await expect.poll(() => panel.evaluate(element => element.scrollTop)).toBeGreaterThan(afterArrow);
    await panel.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await expect(down).toHaveCount(0);
  } finally {
    await context.close();
    if (ids.length) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try { for (const id of ids) await db.query('DELETE FROM products WHERE id = $1', [id]); }
      finally { await db.end(); }
    }
  }
});
