import { expect, test } from '@playwright/test';
import { readFile, mkdir } from 'node:fs/promises';
import pg from 'pg';

test('postal choices persist in Product and Buy Request forms', async ({ browser }) => {
  test.setTimeout(480_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Local database required');
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split('## Hybrid\n')[1]?.split('\n## ')[0] ?? '';
  const username = block.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error('Missing local QA account');
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } });
  const db = new pg.Client({ connectionString: databaseUrl });
  let productId = '', requestId = '';
  const errors: string[] = [];
  const suffix = Date.now().toString(36);
  const productTitle = `Step23 товар ${suffix}`, requestTitle = `Step23 запит ${suffix}`;
  try {
    await db.connect();
    const login = await context.request.post('/api/auth/login', { data: { username, password } });
    expect(login.status(), await login.text()).toBe(200);
    const category = (await (await context.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const page = await context.newPage();
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    page.setDefaultTimeout(30000);
    await mkdir('docs/step23-evidence', { recursive: true });
    const categoryField = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
    const fill = async (title: string) => {
      await page.getByLabel('Назва товару').fill(title);
      await categoryField.fill(category.name);
      await page.getByRole('option', { name: new RegExp(category.name) }).first().click();
      await page.getByLabel('Кількість').fill('3');
    };
    await page.goto('/my/products/new');
    await fill(productTitle);
    await page.getByLabel('Ціна за одиницю').fill('100');
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await page.getByRole('checkbox', { name: 'Нова пошта' }).check();
    await page.getByRole('checkbox', { name: 'Укрпошта' }).check();
    await page.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    await expect(page.getByRole('checkbox', { name: 'Поштова доставка' })).toBeDisabled();
    await expect(page.getByRole('checkbox', { name: 'Нова пошта' })).toHaveCount(0);
    await page.getByRole('checkbox', { name: 'Можна домовитися' }).uncheck();
    await expect(page.getByRole('checkbox', { name: 'Нова пошта' })).toBeChecked();
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const option = page.locator('.delivery-option').filter({ hasText: 'Поштова доставка' });
      await option.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await option.screenshot({ path: `docs/step23-evidence/product-${width}.png` });
    }
    const savedProduct = page.waitForResponse(response => response.url().endsWith('/api/products') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const productResponse = await savedProduct;
    expect(productResponse.status()).toBe(201);
    const product = (await productResponse.json()).product;
    productId = product.id;
    expect(product.deliveryOptions[0].postalOperators).toEqual(['NOVA_POSHTA', 'UKRPOSHTA']);
    await page.goto(`/products/${productId}`);
    await expect(page.getByText(/Нова пошта, Укрпошта/).first()).toBeVisible();
    await page.getByRole('button', { name: 'Редагувати товар' }).click();
    await expect(page.getByRole('checkbox', { name: 'Укрпошта' })).toBeChecked();
    await page.getByRole('checkbox', { name: 'Укрпошта' }).uncheck();
    const productUpdate = page.waitForResponse(response => response.url().endsWith(`/api/products/${productId}`) && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Зберегти зміни' }).click();
    expect((await productUpdate).status()).toBe(200);
    const changedProduct = await (await context.request.get(`/api/products/${productId}`)).json();
    expect(changedProduct.product.deliveryOptions[0].postalOperators).toEqual(['NOVA_POSHTA']);
    await page.goto('/my/requests/new');
    await fill(requestTitle);
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await page.getByRole('checkbox', { name: 'Укрпошта' }).check();
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      const option = page.locator('.delivery-option').filter({ hasText: 'Поштова доставка' });
      await option.evaluate(element => element.scrollIntoView({ block: 'center' }));
      await option.screenshot({ path: `docs/step23-evidence/request-${width}.png` });
    }
    const savedRequest = page.waitForResponse(response => response.url().endsWith('/api/buy-requests') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати запит' }).click();
    const requestResponse = await savedRequest;
    expect(requestResponse.status()).toBe(201);
    const item = (await requestResponse.json()).buyRequest;
    requestId = item.id;
    expect(item.deliveryOptions[0].postalOperators).toEqual(['UKRPOSHTA']);
    await page.goto('/my/requests');
    await page.locator('.buy-request-card').filter({ hasText: requestTitle }).getByRole('button', { name: 'Редагувати' }).click();
    const dialog = page.getByRole('dialog', { name: 'Редагувати запит' });
    await expect(dialog.getByRole('checkbox', { name: 'Укрпошта' })).toBeChecked();
    await dialog.getByRole('checkbox', { name: 'Нова пошта' }).check();
    const updated = page.waitForResponse(response => response.url().endsWith(`/api/buy-requests/${requestId}`) && response.request().method() === 'PATCH');
    await dialog.getByRole('button', { name: 'Зберегти', exact: true }).click();
    expect((await updated).status()).toBe(200);
    const reopened = await (await context.request.get(`/api/buy-requests/${requestId}`)).json();
    expect(reopened.buyRequest.deliveryOptions[0].postalOperators).toEqual(['UKRPOSHTA', 'NOVA_POSHTA']);
    expect(errors).toEqual([]);
  } finally {
    if (requestId) await db.query('DELETE FROM buy_requests WHERE id=$1', [requestId]);
    if (productId) await db.query('DELETE FROM products WHERE id=$1', [productId]);
    await db.end();
    await context.close();
  }
});

test('postal subscription notification and Product offer through real browser', async ({ browser }) => {
  test.setTimeout(480_000);
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !['localhost', '127.0.0.1'].includes(new URL(databaseUrl).hostname)) throw new Error('Local database required');
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const account = (name: string) => {
    const block = text.split(`## ${name}\n`)[1]?.split('\n## ')[0] ?? '';
    const username = block.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
    const password = block.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
    if (!username || !password) throw new Error('Missing local QA account');
    return { username, password };
  };
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const db = new pg.Client({ connectionString: databaseUrl });
  let productId = '', requestId = '', subscriptionId = '';
  const additionalRequests: string[] = [];
  const errors: string[] = [];
  try {
    await db.connect();
    await mkdir('docs/step23-evidence', { recursive: true });
    const sellerLogin = await seller.request.post('/api/auth/login', { data: account('Hybrid') });
    expect(sellerLogin.status(), await sellerLogin.text()).toBe(200);
    const buyerLogin = await buyer.request.post('/api/auth/login', { data: account('Buyer A') });
    expect(buyerLogin.status(), await buyerLogin.text()).toBe(200);
    const category = (await (await seller.request.get('/api/categories')).json()).categories.find((item: { code: string }) => item.code === 'grains');
    const page = await seller.newPage(); page.setDefaultTimeout(30000);
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.goto('/settings/demand-subscriptions');
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(category.name);
    await page.getByRole('option', { name: new RegExp(category.name) }).first().click();
    await page.getByRole('combobox', { name: 'Країна, область або населений пункт' }).fill('Рівне');
    await page.getByRole('option', { name: /^місто, Рівне, .*Рівненська область/ }).click();
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await page.getByRole('checkbox', { name: 'Нова пошта' }).check();
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const option = page.locator('.delivery-option').filter({ hasText: 'Поштова доставка' });
      await option.evaluate(element => element.scrollIntoView({ block: 'center' }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await option.screenshot({ path: `docs/step23-evidence/subscription-${width}.png` });
    }
    const saved = page.waitForResponse(response => response.url().endsWith('/api/demand-subscriptions') && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    const response = await saved; expect(response.status()).toBe(201);
    const subscription = (await response.json()).subscription;
    subscriptionId = subscription.id;
    expect(subscription.deliveryOptions).toEqual([{ method: 'POSTAL_DELIVERY', nationwide: true, postalOperators: ['NOVA_POSHTA'] }]);
    const suffix = Date.now().toString(36);
    const product = await seller.request.post('/api/products', { data: { categoryId: subscription.category.id, title: `Поштовий товар ${suffix}`, quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'carrier', deliveryOptions: [{ method: 'POSTAL_DELIVERY', nationwide: true, postalOperators: ['NOVA_POSHTA'] }], geoZone: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active' } });
    expect(product.status()).toBe(201); productId = (await product.json()).product.id;
    const title = `Поштовий запит ${suffix}`;
    const item = await buyer.request.post('/api/buy-requests', { data: { categoryId: subscription.category.id, title, description: '', quantity: 3, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', countryCode: 'UA', deliveryOptions: [{ method: 'POSTAL_DELIVERY', postalOperators: ['NOVA_POSHTA', 'UKRPOSHTA'] }] } });
    expect(item.status()).toBe(201); requestId = (await item.json()).buyRequest.id;
    const alerts = (await (await seller.request.get('/api/notifications')).json()).notifications;
    expect(alerts.filter((alert: { buyRequestId: string }) => alert.buyRequestId === requestId)).toHaveLength(1);
    await page.goto('/notifications');
    await expect(page.getByText(title).first()).toBeVisible();
    await page.goto(`/buy-requests/${requestId}`);
    await page.getByRole('button', { name: 'Запропонувати товар' }).click();
    const form = page.locator('form.seller-offer-form');
    await form.getByLabel('Свій товар').check();
    await form.getByLabel('Мій активний товар').selectOption(productId);
    await form.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await expect(form.getByRole('checkbox', { name: 'Нова пошта' })).toBeChecked();
    await form.getByRole('button', { name: 'Переглянути умови' }).click();
    for (const width of [320, 390, 768, 1024, 1280, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      const option = form.locator('.delivery-option').filter({ hasText: 'Поштова доставка' });
      await option.evaluate(element => element.scrollIntoView({ block: 'center' }));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)).toBe(true);
      await option.screenshot({ path: `docs/step23-evidence/offer-${width}.png` });
    }
    await form.screenshot({ path: 'docs/step23-evidence/offer.png' });
    await form.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    await expect(form).toHaveCount(0);
    const offers = (await (await buyer.request.get(`/api/buy-requests/${requestId}/offers`)).json()).offers;
    expect(offers[0].deliveryCompatibility.status).toBe('EXACT_MATCH');
    const makeRequest = async (titlePart: string, deliveryOptions: unknown[]) => {
      const result = await buyer.request.post('/api/buy-requests', { data: { categoryId: subscription.category.id, title: `${titlePart} ${suffix}`, description: '', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', countryCode: 'UA', deliveryOptions } });
      expect(result.status()).toBe(201);
      const id = (await result.json()).buyRequest.id as string; additionalRequests.push(id); return id;
    };
    const offer = async (id: string, deliveryOptions: unknown[]) => {
      const result = await seller.request.post(`/api/buy-requests/${id}/offers`, { data: { creationMode: 'product', productId, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Умови передачі', deliveryOptions } });
      expect(result.status()).toBe(201); return (await result.json()).offer.deliveryCompatibility.status;
    };
    const postal = { method: 'POSTAL_DELIVERY', nationwide: true, postalOperators: ['NOVA_POSHTA'] };
    const incompatible = await makeRequest('Різні оператори', [{ method: 'POSTAL_DELIVERY', postalOperators: ['UKRPOSHTA'] }]);
    expect(await offer(incompatible, [postal])).toBe('NO_MATCH');
    const flexible = await makeRequest('Домовленість', [{ method: 'FLEXIBLE' }]);
    expect(await offer(flexible, [postal])).toBe('POSSIBLE_AGREEMENT');
    expect((await seller.request.patch(`/api/products/${productId}`, { data: { deliveryOptions: [{ method: 'SELF_PICKUP' }, postal] } })).status()).toBe(200);
    const mixed = await makeRequest('Пошта або самовивіз', [{ method: 'POSTAL_DELIVERY', postalOperators: ['UKRPOSHTA'] }, { method: 'SELF_PICKUP', region: 'Рівненська область' }]);
    expect(await offer(mixed, [{ method: 'SELF_PICKUP' }])).toBe('EXACT_MATCH');
    expect(errors).toEqual([]);
  } finally {
    if (subscriptionId) await seller.request.delete(`/api/demand-subscriptions/${subscriptionId}`);
    const requestIds = [...(requestId ? [requestId] : []), ...additionalRequests];
    if (requestIds.length) {
      await db.query('DELETE FROM notifications WHERE buy_request_id=ANY($1::uuid[])', [requestIds]);
      await db.query('DELETE FROM buy_requests WHERE id=ANY($1::uuid[])', [requestIds]);
    }
    if (productId) await db.query('DELETE FROM products WHERE id=$1', [productId]);
    await db.end(); await seller.close(); await buyer.close();
  }
});
