import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const fixture = existsSync('docs/TEST_ACCOUNTS.local.md') ? readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8').replace(/\r\n/g, '\n') : '';
test.skip(!fixture, 'Local QA accounts are required.');
const section = fixture.split('## Hybrid\n')[1]?.split('\n## ')[0] ?? '';
const username = section.match(/Username: (.+)/)?.[1].trim();
const password = section.match(/Password: (.+)/)?.[1].trim();

for (const width of [320, 360, 390, 430, 768, 1024, 1280, 1440]) {
  test(`Step 17 search layout at ${width}px`, async ({ browser }) => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width, height: 800 } });
    try {
      expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200);
      const page = await context.newPage();
      await page.goto('/discover');
      await expect(page.locator('.map-canvas.leaflet-container')).toBeVisible();
      if (width <= 760) {
        await page.locator('.mobile-nav').getByRole('button', { name: /Знайти/ }).click();
        await expect.poll(async () => page.locator('.map-canvas').evaluate(element => {
          const rect = element.getBoundingClientRect();
          return rect.top >= 0 && rect.top < window.innerHeight - 100;
        })).toBe(true);
      }
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } finally { await context.close(); }
  });
}

test('Step 17 Find restores the current map search after visiting another page', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 800 } });
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200);
    const page = await context.newPage();
    await page.goto('/discover');
    await page.locator('.map-search-main input').fill('Step17 saved search');
    await page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click();
    await expect(page.locator('.map-search-main input')).toHaveValue('Step17 saved search');
    await expect.poll(() => page.evaluate(() => JSON.parse(sessionStorage.getItem('discoverMapState') ?? 'null')?.mapQuery)).toBe('Step17 saved search');
    await page.locator('.mobile-nav').getByRole('button', { name: /Кабінет/ }).click();
    await expect(page).toHaveURL(/\/cabinet$/);
    await page.locator('.mobile-nav').getByRole('button', { name: /Знайти/ }).click();
    await expect(page.locator('.map-search-main input')).toHaveValue('Step17 saved search');
    await expect.poll(async () => page.locator('.map-canvas').evaluate(element => element.getBoundingClientRect().top < window.innerHeight - 100)).toBe(true);
  } finally { await context.close(); }
});

test('Step 17 request picker, delivery choices, seller checkbox and avatar fit', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 320, height: 700 } });
  try {
    expect((await context.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200);
    const page = await context.newPage();
    await page.goto('/my/requests/new');
    const multipleSellers = page.getByRole('checkbox', { name: 'Можна придбати частинами у різних продавців' });
    await expect(multipleSellers).not.toBeChecked();
    await multipleSellers.check();
    await expect(multipleSellers).toBeChecked();
    await multipleSellers.uncheck();
    await expect(multipleSellers).not.toBeChecked();
    await expect(page.locator('select[name="currency"] option').filter({ hasText: 'USD' })).toHaveCount(1);
    await page.locator('.category-picker input[role="combobox"]').click();
    const auto = page.locator('.category-picker-mobile-tree .category-picker-row').filter({ hasText: 'Авто' }).first();
    await auto.locator('button').first().click();
    await expect(page.locator('.category-picker-back')).toBeVisible();
    await expect(page.locator('.category-picker-mobile-tree .category-picker-row').first()).toBeVisible();
    await page.locator('.category-picker-back').click();
    const delivery = page.locator('.delivery-option > .subscription-active').first();
    await delivery.click();
    await expect(delivery.locator('input[type="checkbox"]')).toBeChecked();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await page.goto('/my/products/new');
    await expect(page.locator('select[name="currency"] option').filter({ hasText: 'USD' })).toHaveCount(1);
    await page.goto('/settings/profile');
    await page.getByRole('button', { name: 'Редагувати фото та нікнейм' }).click();
    await page.locator('.avatar-editor input[placeholder="Або URL зображення"]').fill('https://example.com/' + 'a'.repeat(1000));
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    await expect(page.locator('.avatar-editor-actions').getByRole('button', { name: 'Зберегти' })).toBeVisible();
    await expect(page.locator('.avatar-editor-actions').getByRole('button', { name: 'Скасувати' })).toBeVisible();
  } finally { await context.close(); }
});

test('Step 17 map selection, clearing, card arrows, favorites and report explanation', async ({ browser }) => {
  test.setTimeout(180000);
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 800 } });
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  let productId = '';
  let requestId = '';
  try {
    expect((await buyer.request.post('/api/auth/login', { data: { username, password } })).status()).toBe(200);
    const sellerSection = fixture.split('## Seller A\n')[1]?.split('\n## ')[0] ?? '';
    expect((await seller.request.post('/api/auth/login', { data: { username: sellerSection.match(/Username: (.+)/)?.[1].trim(), password: sellerSection.match(/Password: (.+)/)?.[1].trim() } })).status()).toBe(200);
    const category = (await (await buyer.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const suffix = Date.now();
    const product = await seller.request.post('/api/products', { data: { categoryId: category.id, title: `Step17 Map Product ${suffix}`, description: '', quantity: 2, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', geoZone: 'Рівне', latitude: 50.6199, longitude: 26.2516, status: 'active', photos: [] } });
    expect(product.status()).toBe(201);
    productId = (await product.json()).product.id;
    const createdRequest = await buyer.request.post('/api/buy-requests', { data: { categoryId: category.id, title: `Step17 Map Request ${suffix}`, description: '', quantity: 2, unit: 'kg', currency: 'USD', minPrice: 100, maxPrice: 100, geoArea: 'Рівне', latitude: 50.6205, longitude: 26.253, fulfillmentMode: 'single_seller' } });
    expect(createdRequest.status()).toBe(201);
    requestId = (await createdRequest.json()).buyRequest.id;
    const favoritesBefore = JSON.stringify(await (await buyer.request.get('/api/favorites')).json());
    const page = await buyer.newPage();
    await page.goto('/discover');
    await page.locator('.map-search-main input').fill('Step17 Map');
    await Promise.all([
      page.waitForResponse(response => response.url().includes('/api/map/markers?') && new URL(response.url()).searchParams.get('q') === 'Step17 Map' && response.ok(), { timeout: 20000 }),
      page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click(),
    ]);
    await expect(page.locator('.map-pin-request').first()).toBeVisible();
    await expect(page.locator('.map-pin[data-kind="product"]').first()).toBeVisible();
    await page.locator('.map-pin[data-kind="product"]').first().click();
    await expect(page.locator('.map-listing-preview')).toContainText(`Step17 Map Product ${suffix}`);
    await expect(page.locator('.map-pin-selected')).toHaveCount(1);
    const markerAndCardVisible = () => page.evaluate(() => {
      const marker = document.querySelector('.map-pin-selected')?.getBoundingClientRect();
      const card = document.querySelector('.map-listing-preview')?.getBoundingClientRect();
      const headerBottom = document.querySelector('.mobile-topbar')?.getBoundingClientRect().bottom ?? 0;
      const navTop = document.querySelector('.mobile-nav')?.getBoundingClientRect().top ?? innerHeight;
      return Boolean(marker && card && marker.top >= headerBottom - 2 && marker.bottom < navTop && card.top < navTop && card.bottom > headerBottom);
    });
    await expect.poll(markerAndCardVisible).toBe(true);
    await page.locator('.map-pin-request').first().click({ timeout: 10000 });
    await expect(page.locator('.map-listing-preview')).toContainText(`Step17 Map Request ${suffix}`);
    await expect.poll(markerAndCardVisible).toBe(true);
    await page.locator('.map-canvas').click({ position: { x: 100, y: 220 } });
    await expect(page.locator('.map-pin-selected')).toHaveCount(0);
    expect(JSON.stringify(await (await buyer.request.get('/api/favorites')).json())).toBe(favoritesBefore);
    const down = page.getByRole('button', { name: 'Прокрутити картки вниз' });
    await expect(down).toBeVisible();
    const before = await page.locator('.map-summary').evaluate(element => element.scrollTop);
    await down.click();
    await expect.poll(() => page.locator('.map-summary').evaluate(element => element.scrollTop)).toBeGreaterThan(before);
    await page.goto(`/products/${productId}`);
    await page.getByRole('button', { name: 'Пояснення скарги' }).click();
    await expect(page.locator('.category-report-explanation')).toContainText('Скарга не видаляє оголошення автоматично');
    await page.getByRole('button', { name: 'Повідомити про проблему з оголошенням' }).click();
    await expect(page.getByRole('button', { name: 'Надіслати скаргу' })).toBeVisible();
    await page.getByRole('button', { name: 'Надіслати скаргу' }).click();
    await expect(page.getByRole('status')).toContainText('Скаргу збережено для розгляду.');
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const report = await db.query('SELECT id FROM reports WHERE target_id = $1', [productId]);
      expect(report.rowCount).toBe(1);
    } finally { await db.end(); }
  } finally {
    await Promise.allSettled([buyer.close(), seller.close()]);
    if (productId || requestId) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try {
        await db.query('DELETE FROM reports WHERE target_id = ANY($1::uuid[])', [[productId, requestId].filter(Boolean)]);
        if (requestId) await db.query('DELETE FROM buy_requests WHERE id = $1', [requestId]);
        if (productId) await db.query('DELETE FROM products WHERE id = $1', [productId]);
      } finally { await db.end(); }
    }
  }
});
