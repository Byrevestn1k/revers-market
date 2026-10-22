import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const fixture = existsSync('docs/TEST_ACCOUNTS.local.md') ? readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8').replace(/\r\n/g, '\n') : '';
test.skip(!fixture, 'Local QA accounts are required.');
const credentials = (section: string) => {
  const block = fixture.split(`## ${section}\n`)[1]?.split('\n## ')[0] ?? '';
  return { username: block.match(/Username: (.+)/)?.[1].trim(), password: block.match(/Password: (.+)/)?.[1].trim() };
};

test('Step 17 creates Product, Buy Request and Seller Offer with USD through forms', async ({ browser }) => {
  test.setTimeout(180000);
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 390, height: 850 } });
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } });
  let productId = '';
  let requestId = '';
  let offerId = '';
  try {
    expect((await buyer.request.post('/api/auth/login', { data: credentials('Hybrid') })).status()).toBe(200);
    expect((await seller.request.post('/api/auth/login', { data: credentials('Seller A') })).status()).toBe(200);
    const category = (await (await buyer.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'honey_raw');
    expect(category).toBeTruthy();
    const suffix = Date.now();
    const buyerPage = await buyer.newPage();
    await buyerPage.goto('/my/products/new');
    await buyerPage.locator('input[name="title"]').fill(`Step17 USD Product ${suffix}`);
    await buyerPage.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(category.name);
    await buyerPage.getByRole('option').filter({ hasText: category.name }).last().click();
    await buyerPage.locator('input[name="quantity"]').fill('2');
    await buyerPage.locator('input[name="price"]').fill('100');
    await buyerPage.locator('select[name="currency"]').selectOption('USD');
    await buyerPage.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    const productCreated = buyerPage.waitForResponse(response => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST', { timeout: 15000 });
    await buyerPage.getByRole('button', { name: 'Опублікувати товар' }).click();
    const productResponse = await productCreated;
    expect(productResponse.status(), await productResponse.text()).toBe(201);
    productId = (await productResponse.json()).product.id;

    await buyerPage.goto('/my/requests/new');
    await buyerPage.locator('input[name="title"]').fill(`Step17 USD Request ${suffix}`);
    await buyerPage.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(category.name);
    await buyerPage.getByRole('option').filter({ hasText: category.name }).last().click();
    await buyerPage.locator('input[name="quantity"]').fill('2');
    await buyerPage.locator('select[name="currency"]').selectOption('USD');
    await buyerPage.locator('input[name="minPrice"]').fill('100');
    await buyerPage.locator('input[name="maxPrice"]').fill('100');
    await expect(buyerPage.getByRole('checkbox', { name: 'Можна придбати частинами у різних продавців' })).not.toBeChecked();
    await buyerPage.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    const requestCreated = buyerPage.waitForResponse(response => new URL(response.url()).pathname === '/api/buy-requests' && response.request().method() === 'POST', { timeout: 15000 });
    await buyerPage.getByRole('button', { name: 'Опублікувати запит' }).click();
    const requestResponse = await requestCreated;
    expect(requestResponse.status(), await requestResponse.text()).toBe(201);
    requestId = (await requestResponse.json()).buyRequest.id;

    const sellerPage = await seller.newPage();
    await sellerPage.goto(`/buy-requests/${requestId}`);
    await expect(sellerPage.getByText(/100.*\$/).first()).toBeVisible();
    await sellerPage.getByRole('button', { name: 'Запропонувати товар' }).click();
    const form = sellerPage.locator('form.seller-offer-form');
    await expect(form).toContainText('USD');
    await form.getByLabel(/Ціна за/).fill('100');
    await form.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    await form.getByRole('button', { name: 'Переглянути умови' }).click();
    const offerCreated = sellerPage.waitForResponse(response => new URL(response.url()).pathname === `/api/buy-requests/${requestId}/offers` && response.request().method() === 'POST', { timeout: 15000 });
    await form.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    const offerResponse = await offerCreated;
    expect(offerResponse.status(), await offerResponse.text()).toBe(201);
    offerId = (await offerResponse.json()).offer.id;
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const rows = await db.query('SELECT p.currency AS product_currency, b.currency AS request_currency, b.fulfillment_mode, o.currency AS offer_currency FROM products p, buy_requests b, offers o WHERE p.id = $1 AND b.id = $2 AND o.id = $3', [productId, requestId, offerId]);
      expect(rows.rows[0]).toMatchObject({ product_currency: 'USD', request_currency: 'USD', offer_currency: 'USD', fulfillment_mode: 'single_seller' });
    } finally { await db.end(); }
  } finally {
    await Promise.allSettled([buyer.close(), seller.close()]);
    if (productId || requestId) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try {
        if (offerId) await db.query('DELETE FROM offers WHERE id = $1', [offerId]);
        if (requestId) await db.query('DELETE FROM buy_requests WHERE id = $1', [requestId]);
        if (productId) await db.query('DELETE FROM products WHERE id = $1', [productId]);
      } finally { await db.end(); }
    }
  }
});
