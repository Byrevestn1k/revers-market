import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const account = async (section: string) => {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error(`Missing documented QA account: ${section}`);
  return { username, password };
};

async function login(page: Page, section: string, destination: string) {
  const credentials = await account(section);
  await page.goto('/auth/login?return=' + encodeURIComponent(destination));
  await page.locator('input[name="username"]').fill(credentials.username);
  await page.locator('input[name="password"]').fill(credentials.password);
  const response = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
  expect((await response).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/') + '$'));
  return credentials.username;
}

test('Step 15: real Buyer Request and Seller Product search across browser widths', async ({ browser }) => {
  test.setTimeout(450_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Run only against the local PostgreSQL QA database');
  const contexts: BrowserContext[] = [];
  const db = new pg.Client({ connectionString: databaseUrl });
  let dbConnected = false;
  const profileSnapshots: { id: string; map_location_mode: string; public_latitude: number | null; public_longitude: number | null; settlement_code: string | null; location_display: string | null }[] = [];
  const ids: { products: string[]; requests: string[] } = { products: [], requests: [] };
  const stamp = Date.now().toString(36);
  const productTitle = `Велосипед Step15 ${stamp}`;
  const requestTitle = `Шукаю велосипед Step15 ${stamp}`;
  try {
    await db.connect();
    dbConnected = true;
    const usernames = [(await account('Buyer A')).username, (await account('Seller A')).username];
    const savedProfiles = await db.query('SELECT id,map_location_mode,public_latitude,public_longitude,settlement_code,location_display FROM users WHERE username = ANY($1::text[])', [usernames]);
    if (savedProfiles.rows.length !== 2) throw new Error('Both documented QA accounts must exist');
    profileSnapshots.push(...savedProfiles.rows);
    await db.query("UPDATE users SET map_location_mode='pin', public_latitude=50.6199, public_longitude=26.2516, settlement_code='UA56060470010041018', location_display='Рівне' WHERE username = ANY($1::text[])", [usernames]);
    const buyerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173' });
    const sellerContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173' });
    contexts.push(buyerContext, sellerContext);
    const buyer = await buyerContext.newPage();
    const seller = await sellerContext.newPage();
    const buyerUsername = await login(buyer, 'Buyer A', '/my/requests/new');
    const sellerUsername = await login(seller, 'Seller A', '/my/products/new');
    console.log('Step 15 QA accounts authenticated in browser');
    const categories = (await (await buyerContext.request.get('/api/categories')).json()).categories as { id: string; name: string; code: string }[];
    const category = categories.find(item => item.code === 'grains')!;
    const pickCategory = async (page: Page) => {
      await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(category.name);
      await page.getByRole('option', { name: new RegExp(category.name) }).first().click();
    };

    await buyer.getByLabel('Назва товару').fill(requestTitle);
    await buyer.locator('textarea[name="description"]').fill('Червоний дитячий велосипед Trek');
    await pickCategory(buyer);
    await buyer.getByLabel('Кількість').fill('1');
    await buyer.getByLabel('Один продавець').check();
    await buyer.getByLabel('Поштова доставка').check();
    await expect(buyer.getByText('✓ Точку для мапи визначено')).toBeVisible();
    const requestCreated = buyer.waitForResponse(r => new URL(r.url()).pathname === '/api/buy-requests' && r.request().method() === 'POST');
    await buyer.getByRole('button', { name: 'Опублікувати запит' }).click();
    const requestResponse = await requestCreated;
    expect(requestResponse.status(), await requestResponse.text()).toBe(201);
    ids.requests.push((await requestResponse.json()).buyRequest.id);
    console.log('Buyer Request created through browser');

    await seller.getByLabel('Назва товару').fill(productTitle);
    await seller.locator('textarea[name="description"]').fill('Червоний дитячий Trek, колеса 20 дюймів');
    await pickCategory(seller);
    const selectedCategoryId = await seller.locator('input[name="categoryId"]').inputValue();
    await seller.getByLabel('Кількість').fill('1');
    await seller.getByLabel('Ціна за одиницю').fill('100');
    await seller.getByLabel('Поштова доставка').check();
    await expect(seller.getByText('✓ Точку для мапи визначено')).toBeVisible();
    const productCreated = seller.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && r.request().method() === 'POST');
    await seller.getByRole('button', { name: 'Опублікувати товар' }).click();
    const productResponse = await productCreated;
    expect(productResponse.status(), await productResponse.text()).toBe(201);
    ids.products.push((await productResponse.json()).product.id);
    console.log('Seller Product created through browser');

    const modelBase = { categoryId: selectedCategoryId, description: 'Смартфон', quantity: 1, unit: 'piece', price: 100, currency: 'UAH', deliveryMode: 'pickup', status: 'active', geoZone: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516 };
    for (const model of ['S23', 'S24']) {
      const response = await sellerContext.request.post('/api/products', { data: { ...modelBase, title: `Samsung Galaxy ${model} Ultra ${stamp}` } });
      expect(response.status(), await response.text()).toBe(201);
      ids.products.push((await response.json()).product.id);
    }

    await buyer.goto('/products');
    await expect(buyer.locator('.product-grid')).toBeVisible({ timeout: 30000 });
    for (const query of ['червоний дитячий велосипед', 'велосипед дитячий червоний', 'велосепед дитячий']) {
      console.log(`Starting catalog query: ${query}`);
      await buyer.getByRole('searchbox', { name: 'Пошук товару або продавця' }).fill(query);
      const found = buyer.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && new URL(r.url()).searchParams.get('q') === query, { timeout: 30000 });
      await buyer.getByRole('button', { name: 'Пошук', exact: true }).click();
      const foundResponse = await found;
      const foundBody = await foundResponse.json();
      expect(foundResponse.status(), JSON.stringify(foundBody)).toBe(200);
      expect(foundBody.products.map((item: { id: string }) => item.id)).toContain(ids.products[0]);
      await expect(buyer.locator('.product-grid')).toContainText(productTitle, { timeout: 30000 });
      console.log(`Catalog found Product for: ${query}`);
    }
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyer.setViewportSize({ width, height: 900 });
      await expect(buyer.getByRole('searchbox', { name: 'Пошук товару або продавця' })).toBeVisible();
      await expect(buyer.locator('.product-grid')).toContainText(productTitle);
      expect(await buyer.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Catalog overflow at ${width}`).toBe(true);
      const box = await buyer.getByRole('searchbox', { name: 'Пошук товару або продавця' }).boundingBox();
      expect(box!.width, `Search field collapsed at ${width}`).toBeGreaterThan(100);
    }
    await buyer.setViewportSize({ width: 1440, height: 900 });
    await buyer.locator('.product-grid').getByText(productTitle).first().click();
    await expect(buyer).toHaveURL(new RegExp(`/products/${ids.products[0]}$`));
    await buyer.goBack();
    await expect(buyer.getByRole('searchbox', { name: 'Пошук товару або продавця' })).toHaveValue('велосепед дитячий');
    await buyer.getByRole('searchbox', { name: 'Пошук товару або продавця' }).fill('Samsung Galaxy S23');
    await buyer.getByRole('button', { name: 'Пошук', exact: true }).click();
    await expect(buyer.locator('.product-grid')).toContainText(`Samsung Galaxy S23 Ultra ${stamp}`, { timeout: 30000 });
    await expect(buyer.locator('.product-grid')).not.toContainText(`Samsung Galaxy S24 Ultra ${stamp}`);
    const unrelated = categories.find(item => item.name === 'Мед')!;
    await buyer.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(unrelated.name);
    await buyer.getByRole('option', { name: new RegExp(unrelated.name) }).first().click();
    await expect(buyer.getByText('Нічого не знайдено')).toBeVisible({ timeout: 30000 });
    await pickCategory(buyer);
    await expect(buyer.locator('.product-grid')).toContainText(`Samsung Galaxy S23 Ultra ${stamp}`, { timeout: 30000 });

    const mapQuery = `червоний дитячий велосипед ${stamp}`;
    await seller.goto('/requests');
    await expect(seller.getByRole('searchbox', { name: 'Пошук запитів покупців' })).toBeVisible({ timeout: 30000 });
    await seller.getByRole('searchbox', { name: 'Пошук запитів покупців' }).fill(mapQuery);
    await seller.getByRole('button', { name: 'Пошук запитів', exact: true }).click();
    const requestCard = seller.getByRole('button', { name: 'Відкрити запит: ' + requestTitle });
    await expect(requestCard).toBeVisible({ timeout: 30000 });
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await seller.setViewportSize({ width, height: 900 });
      await expect(requestCard).toBeVisible();
      expect(await seller.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Request search overflow at ${width}`).toBe(true);
      expect((await seller.getByRole('searchbox', { name: 'Пошук запитів покупців' }).boundingBox())!.width).toBeGreaterThan(100);
    }
    await seller.setViewportSize({ width: 1440, height: 900 });
    await requestCard.click();
    await expect(seller).toHaveURL(new RegExp(`/buy-requests/${ids.requests[0]}$`));
    await seller.goBack();
    await expect(seller.getByRole('searchbox', { name: 'Пошук запитів покупців' })).toHaveValue(mapQuery);

    await seller.goto('/map');
    await seller.getByRole('searchbox', { name: /Пошук товару/ }).fill(mapQuery);
    const mapRequest = seller.locator('.map-listing-result').filter({ hasText: requestTitle }).first();
    await expect(mapRequest).toBeVisible({ timeout: 30000 });
    await seller.getByLabel('Спосіб отримання').selectOption('POSTAL_DELIVERY');
    await expect(mapRequest).toBeVisible({ timeout: 30000 });
    await seller.getByLabel('Спосіб отримання').selectOption('SELF_PICKUP');
    await expect(mapRequest).toHaveCount(0, { timeout: 30000 });
    await seller.getByLabel('Спосіб отримання').selectOption('');
    await expect(mapRequest).toBeVisible({ timeout: 30000 });
    const matches = await sellerContext.request.get('/api/map/markers', { params: { latitude: 50.62, longitude: 26.25, radiusKm: 50, q: mapQuery, searchIn: 'all' } });
    expect(matches.status()).toBe(200);
    expect((await matches.json()).markers.map((item: { id: string }) => item.id)).toContain(ids.requests[0]);
    console.log(JSON.stringify({ browserQA: 'passed', buyerUsername, sellerUsername, viewports: [1440, 1280, 1024, 768, 390, 320] }));
  } finally {
    await Promise.allSettled(contexts.map(context => context.close()));
    if (dbConnected) try {
      // Delete only records created by this run and owned by the documented QA accounts.
      for (const id of ids.requests) await db.query('DELETE FROM buy_requests WHERE id=$1 AND buyer_id=(SELECT id FROM users WHERE username=$2)', [id, (await account('Buyer A')).username]);
      for (const id of ids.products) await db.query('DELETE FROM products WHERE id=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [id, (await account('Seller A')).username]);
      for (const profile of profileSnapshots) await db.query('UPDATE users SET map_location_mode=$1,public_latitude=$2,public_longitude=$3,settlement_code=$4,location_display=$5 WHERE id=$6', [profile.map_location_mode, profile.public_latitude, profile.public_longitude, profile.settlement_code, profile.location_display, profile.id]);
    } finally { await db.end(); }
  }
});
