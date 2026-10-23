import { expect, request as apiRequest, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const accounts = existsSync('docs/TEST_ACCOUNTS.local.md') ? readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8').replace(/\r\n/g, '\n') : '';
test.skip(!accounts || !process.env.DATABASE_URL, 'Local QA accounts and database are required.');
const credentials = (section: string) => {
  const block = accounts.split(`## ${section}\n`)[1]?.split('\n## ')[0] ?? '';
  return { username: block.match(/Username: (.+)/)?.[1].trim(), password: block.match(/Password: (.+)/)?.[1].trim() };
};

test('Step 18 groups both listing types and drills from Ukraine to markers', async ({ browser }) => {
  test.setTimeout(600000);
  const seller = await apiRequest.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const buyer = await apiRequest.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const productIds: string[] = [];
  const requestIds: string[] = [];
  const suffix = `Geo18${Date.now()}`;
  try {
    expect((await seller.post('/api/auth/login', { data: credentials('Seller A') })).status()).toBe(200);
    expect((await buyer.post('/api/auth/login', { data: credentials('Buyer A') })).status()).toBe(200);
    const category = (await (await seller.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const locations = [
      { name: 'Рівне', code: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516 },
      { name: 'Київ', code: 'UA80000000000093317', latitude: 50.4501, longitude: 30.5234 },
    ];
    for (const location of locations) {
      const created = await seller.post('/api/products', { data: { categoryId: category.id, title: `${suffix} товар ${location.name}`, description: '', quantity: 10, unit: 'kg', price: 10, currency: 'UAH', deliveryMode: 'pickup', geoZone: location.name, settlementCode: location.code, latitude: location.latitude, longitude: location.longitude, mapLocationMode: 'pin', status: 'active' } });
      expect(created.status(), await created.text()).toBe(201);
      productIds.push((await created.json()).product.id);
    }
    const rivne = locations[0];
    const createdRequest = await buyer.post('/api/buy-requests', { data: { categoryId: category.id, title: `${suffix} запит Рівне`, description: '', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 10, receiptMethod: 'SELF_PICKUP', countryCode: 'UA', geoArea: rivne.name, settlementCode: rivne.code, latitude: rivne.latitude, longitude: rivne.longitude, mapLocationMode: 'pin' } });
    expect(createdRequest.status(), await createdRequest.text()).toBe(201);
    requestIds.push((await createdRequest.json()).buyRequest.id);

    const widths = process.env.GEO_TEST_WIDTH ? [Number(process.env.GEO_TEST_WIDTH)] : [320, 390, 430, 768, 1024, 1280, 1440];
    for (const width of widths) {
      const context = await browser.newContext({ viewport: { width, height: 800 } });
      try {
        const page = await context.newPage();
        await page.goto('/discover');
        await expect(page.locator('.map-canvas.leaflet-container')).toBeVisible();
        await page.locator('.map-search-main input').fill(suffix);
        await page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click();
        await expect(page.locator('.map-geo-group')).toHaveCount(2);
        await expect(page.locator('.map-result-count')).toContainText('3 результатів');
        await expect(page.locator('.map-geo-group').filter({ hasText: 'Рівненська область' })).toContainText('2');
        if (width === 390) {
          await page.locator('.map-delivery-filter select').selectOption('POSTAL_DELIVERY');
          await expect(page.locator('.map-geo-group')).toHaveCount(0);
          await page.locator('.map-delivery-filter select').selectOption('SELF_PICKUP');
          await expect(page.locator('.map-geo-group')).toHaveCount(2);
          const picker = page.locator('.map-search-category');
          await picker.getByRole('combobox').fill(category.name);
          const selectParent = picker.getByRole('button', { name: `Вибрати категорію ${category.name}` });
          if (await selectParent.first().isVisible()) await selectParent.first().click();
          else await picker.getByRole('option', { name: category.name }).first().click();
          await expect(page.locator('.map-geo-group')).toHaveCount(2);
        }
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        await page.locator('.map-geo-group').filter({ hasText: 'Рівненська область' }).click();
        await expect(page.locator('.map-geo-group').filter({ hasText: 'Рівненський район' })).toBeVisible();
        await page.locator('.map-geo-group').filter({ hasText: 'Рівненський район' }).click();
        await expect.poll(() => page.locator('.map-pin').count()).toBeGreaterThan(0);
        await page.locator('.map-pin').first().click();
        await expect(page.locator('.map-summary')).toContainText(suffix);
        expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
        if (width === 390) {
          const nextQuery = `${suffix} товар`;
          await page.locator('.map-search-main input').fill(nextQuery);
          const groupedResponse = page.waitForResponse((response) => {
            const url = new URL(response.url());
            return url.pathname === '/api/map/markers' && url.searchParams.get('q') === nextQuery && url.searchParams.get('geoLevel') === 'region';
          });
          await page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click();
          const response = await groupedResponse;
          expect((await response.json()).markers).toEqual([]);
          await expect(page.locator('.map-geo-group')).toHaveCount(2);
        }
      } finally { await context.close(); }
    }
  } finally {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try {
      if (requestIds.length) await client.query('DELETE FROM buy_requests WHERE id = ANY($1::uuid[])', [requestIds]);
      if (productIds.length) await client.query('DELETE FROM products WHERE id = ANY($1::uuid[])', [productIds]);
    } finally { await client.end(); await seller.dispose(); await buyer.dispose(); }
  }
});
