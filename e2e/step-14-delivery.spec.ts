import { expect, test, type BrowserContext, type Page } from '@playwright/test';
import { Client } from 'pg';

const baseURL = process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5179';
const rivneCode = 'UA56060470010041018';
const lutskCode = 'UA07080170010083384';
const dubnoCode = 'UA56040110010080334';

test('Step 14: real postal subscription, Product, Request, Offer and Deal across screen sizes', async ({ browser }) => {
  test.setTimeout(360_000);
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.includes('step14_qa_')) throw new Error('Run only on isolated Step 14 QA database');
  const stamp = Date.now().toString(36);
  const contexts: BrowserContext[] = [];
  const userIds: string[] = [];
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  let dbConnected = false;
  let buyerPage: Page | undefined;
  let sellerPage: Page | undefined;
  try {
    for (const [index, role] of ['buyer', 'seller'].entries()) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
      contexts.push(context);
      const username = `step14_${role}_${stamp}`;
      const created = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${String(Date.now()).slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } });
      expect(created.status(), await created.text()).toBe(201);
      userIds.push((await created.json()).user.id);
      expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200);
      expect((await context.request.patch('/api/profile/me', { data: { location: 'Рівне', settlementCode: rivneCode, mapLocation: { mode: 'pin', latitude: 50.6199, longitude: 26.2516, consent: true } } })).status()).toBe(200);
    }
    buyerPage = await contexts[0].newPage();
    sellerPage = await contexts[1].newPage();
    const categories = (await (await contexts[0].request.get('/api/categories')).json()).categories as { id: string; code: string; name: string }[];
    const category = categories.find(item => item.code === 'grains')!;
    const pickCategory = async (page: Page) => {
      const field = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
      await field.fill(category.name);
      await page.getByRole('option', { name: new RegExp(category.name) }).first().click();
    };

    await sellerPage.goto('/settings/demand-subscriptions');
    await sellerPage.getByRole('button', { name: 'Додати підписку' }).click();
    const subscription = sellerPage.getByRole('form', { name: 'Нова підписка' });
    await pickCategory(subscription as unknown as Page);
    await subscription.getByRole('combobox', { name: 'Країна, область або населений пункт' }).click();
    await subscription.getByRole('option', { name: /Уся Україна/ }).click();
    await subscription.getByLabel('Поштова доставка').check();
    await subscription.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(sellerPage.getByRole('article', { name: /Підписка:/ })).toContainText('Поштова доставка');

    const requestTitle = `Запит Step 14 ${stamp}`;
    await buyerPage.goto('/my/requests/new');
    await buyerPage.getByLabel('Назва товару').fill(requestTitle);
    await pickCategory(buyerPage);
    await buyerPage.getByLabel('Кількість').fill('3');
    await buyerPage.getByLabel('Один продавець').check();
    await buyerPage.getByLabel('Поштова доставка').check();
    await expect(buyerPage.getByText('✓ Точку для мапи визначено')).toBeVisible();
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyerPage.setViewportSize({ width, height: 900 });
      expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Request form overflow at ${width}`).toBe(true);
    }
    await buyerPage.getByRole('button', { name: 'Опублікувати запит' }).click();
    await expect(buyerPage).toHaveURL(/\/map$/);
    const ownRequests = (await (await contexts[0].request.get('/api/buy-requests', { params: { mine: 'true' } })).json()).buyRequests;
    const createdRequest = ownRequests.find((item: { title: string }) => item.title === requestTitle);
    expect(createdRequest?.deliveryOptions).toEqual([{ method: 'POSTAL_DELIVERY' }]);
    const requestId = createdRequest.id as string;
    await sellerPage.goto('/notifications');
    await expect(sellerPage.getByText(requestTitle).first()).toBeVisible();

    const productTitle = `Товар Step 14 ${stamp}`;
    await sellerPage.goto('/my/products/new');
    await sellerPage.getByLabel('Назва товару').fill(productTitle);
    await pickCategory(sellerPage);
    await sellerPage.getByLabel('Кількість').fill('10');
    await sellerPage.getByLabel('Ціна за одиницю').fill('120');
    await sellerPage.getByLabel('Поштова доставка').check();
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await sellerPage.setViewportSize({ width, height: 900 });
      expect(await sellerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Product form overflow at ${width}`).toBe(true);
    }
    await sellerPage.getByRole('button', { name: 'Опублікувати товар' }).click();
    await expect(sellerPage).toHaveURL(/\/my\/products$/);
    const products = (await (await contexts[1].request.get('/api/products', { params: { mine: 'true' } })).json()).products;
    const createdProduct = products.find((item: { title: string }) => item.title === productTitle);
    expect(createdProduct, JSON.stringify(products.map((item: { title: string }) => item.title))).toBeTruthy();
    const productId = createdProduct.id as string;

    await sellerPage.goto(`/buy-requests/${requestId}`);
    await sellerPage.getByRole('button', { name: 'Запропонувати товар' }).click();
    const offerForm = sellerPage.locator('form.seller-offer-form');
    await offerForm.getByLabel('Свій товар').check();
    await offerForm.getByLabel('Мій активний товар').selectOption(productId);
    await offerForm.getByLabel('Поштова доставка').check();
    await offerForm.getByRole('button', { name: 'Переглянути умови' }).click();
    await expect(offerForm.getByText('Поштова доставка', { exact: false }).first()).toBeVisible();
    await offerForm.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    await expect(offerForm).toHaveCount(0);
    const offers = (await (await contexts[0].request.get(`/api/buy-requests/${requestId}/offers`)).json()).offers;
    expect(offers).toHaveLength(1);
    expect(offers[0].deliveryCompatibility.status).toBe('EXACT_MATCH');
    const offerId = offers[0].id as string;
    await buyerPage.goto(`/buy-requests/${requestId}`);
    await buyerPage.getByText('Детальніше та інші дії').click();
    await expect(buyerPage.getByText('Спосіб отримання й територія сумісні.')).toBeVisible();
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await buyerPage.setViewportSize({ width, height: 900 });
      expect(await buyerPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Offer detail overflow at ${width}`).toBe(true);
    }
    await buyerPage.getByRole('button', { name: 'Обрати пропозицію' }).click();
    const dealDialog = buyerPage.getByRole('dialog', { name: 'Домовитися з продавцем?' });
    await dealDialog.getByRole('button', { name: 'Обрати і домовитися' }).click();
    await expect(dealDialog).toHaveCount(0);
    await db.connect(); dbConnected = true;
    const snapshot = (await db.query('SELECT conditions_snapshot FROM orders WHERE offer_id=$1', [offerId])).rows[0].conditions_snapshot;
    expect(snapshot.delivery.options).toEqual([{ method: 'POSTAL_DELIVERY', nationwide: true }]);
    const forbidden = await contexts[0].request.patch(`/api/buy-requests/${requestId}`, { data: { deliveryOptions: [{ method: 'FLEXIBLE' }] } });
    expect(forbidden.status()).toBe(409);
    expect((await db.query('SELECT conditions_snapshot FROM orders WHERE offer_id=$1', [offerId])).rows[0].conditions_snapshot).toEqual(snapshot);

    // Postal reach changes on the Product, while the accepted Deal keeps its snapshot.
    await sellerPage.goto(`/my/products/${productId}/edit`);
    await sellerPage.getByLabel('Вибрані області').check();
    await sellerPage.getByRole('combobox', { name: 'Додати область' }).click();
    await sellerPage.getByRole('option', { name: 'Рівненська область' }).first().click();
    await sellerPage.getByRole('button', { name: 'Зберегти зміни' }).click();
    await expect(sellerPage).toHaveURL(/\/my\/products$/);
    const restricted = (await (await contexts[1].request.get(`/api/products/${productId}`)).json()).product;
    expect(restricted.deliveryOptions).toEqual([{ method: 'POSTAL_DELIVERY', regions: ['Рівненська область'] }]);
    expect((await db.query('SELECT conditions_snapshot FROM orders WHERE offer_id=$1', [offerId])).rows[0].conditions_snapshot).toEqual(snapshot);
    expect((await contexts[0].request.patch('/api/profile/me', { data: { location: 'Луцьк', settlementCode: 'UA07080170010083384', mapLocation: { mode: 'pin', latitude: 50.747, longitude: 25.325, consent: true } } })).status()).toBe(200);
    await buyerPage.goto('/my/requests/new');
    await buyerPage.getByLabel('Назва товару').fill(`Пошта Луцьк ${stamp}`);
    await pickCategory(buyerPage);
    await buyerPage.getByLabel('Кількість').fill('1');
    await buyerPage.getByLabel('Один продавець').check();
    await buyerPage.getByLabel('Поштова доставка').check();
    await buyerPage.getByRole('button', { name: 'Опублікувати запит' }).click();
    await expect(buyerPage).toHaveURL(/\/map$/);
    const newRequests = (await (await contexts[0].request.get('/api/buy-requests', { params: { mine: 'true' } })).json()).buyRequests;
    const lutskRequestId = newRequests.find((item: { title: string }) => item.title === `Пошта Луцьк ${stamp}`).id as string;
    await sellerPage.goto(`/buy-requests/${lutskRequestId}`);
    await sellerPage.getByRole('button', { name: 'Запропонувати товар' }).click();
    const restrictedOfferForm = sellerPage.locator('form.seller-offer-form');
    await restrictedOfferForm.getByLabel('Свій товар').check();
    await restrictedOfferForm.getByLabel('Мій активний товар').selectOption(productId);
    await restrictedOfferForm.getByLabel('Поштова доставка').check();
    await restrictedOfferForm.getByRole('button', { name: 'Переглянути умови' }).click();
    await restrictedOfferForm.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    await expect(restrictedOfferForm).toHaveCount(0);
    const incompatible = (await (await contexts[0].request.get(`/api/buy-requests/${lutskRequestId}/offers`)).json()).offers[0];
    expect(incompatible.deliveryCompatibility.status).toBe('NO_MATCH');
    await buyerPage.goto(`/buy-requests/${lutskRequestId}`);
    await buyerPage.getByText('Детальніше та інші дії').click();
    await expect(buyerPage.getByText('Спосіб отримання або територія не збігаються з вашим запитом.')).toBeVisible();
    const alertsBefore = (await (await contexts[1].request.get('/api/notifications')).json()).notifications.length;
    await buyerPage.goto('/my/requests/new');
    await buyerPage.getByLabel('Назва товару').fill(`Несумісний для підписки ${stamp}`);
    await pickCategory(buyerPage);
    await buyerPage.getByLabel('Кількість').fill('1');
    await buyerPage.getByLabel('Один продавець').check();
    await buyerPage.getByLabel('Самовивіз').check();
    await buyerPage.getByRole('button', { name: 'Опублікувати запит' }).click();
    await expect(buyerPage).toHaveURL(/\/map$/);
    const alertsAfter = (await (await contexts[1].request.get('/api/notifications')).json()).notifications.length;
    expect(alertsAfter).toBe(alertsBefore);
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    if (userIds.length) {
      if (!dbConnected) { await db.connect(); dbConnected = true; }
      await db.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [userIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    if (dbConnected) await db.end();
  }
});

test('Step 14: pickup, seller delivery radius and flexible agreement in the browser', async ({ browser }) => {
  test.setTimeout(600_000);
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.includes('step14_qa_')) throw new Error('Run only on isolated Step 14 QA database');
  const stamp = Date.now().toString(36);
  const contexts: BrowserContext[] = [];
  const userIds: string[] = [];
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  let dbConnected = false;
  try {
    for (const [index, role] of ['buyer', 'seller'].entries()) {
      const context = await browser.newContext({ baseURL, viewport: { width: 1280, height: 900 } });
      contexts.push(context);
      const username = `step14_geo_${role}_${stamp}`;
      const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '68' : '51'}${String(Date.now()).slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } });
      expect(registered.status(), await registered.text()).toBe(201);
      userIds.push((await registered.json()).user.id);
      expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200);
    }
    const buyer = await contexts[0].newPage();
    const seller = await contexts[1].newPage();
    const category = ((await (await contexts[0].request.get('/api/categories')).json()).categories as { id: string; code: string; name: string }[]).find(item => item.code === 'grains')!;
    const selectCategory = async (page: Page) => {
      await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill(category.name);
      await page.getByRole('option', { name: new RegExp(category.name) }).first().click();
    };
    const place = async (index: number, city: string, code: string, latitude: number, longitude: number) => {
      const response = await contexts[index].request.patch('/api/profile/me', { data: { location: city, settlementCode: code, mapLocation: { mode: 'pin', latitude, longitude, consent: true } } });
      expect(response.status(), await response.text()).toBe(200);
    };
    const createRequest = async (title: string, method: 'SELF_PICKUP' | 'SELLER_DELIVERY' | 'POSTAL_DELIVERY', radius?: string) => {
      await buyer.goto('/my/requests/new');
      await buyer.getByLabel('Назва товару').fill(title);
      await selectCategory(buyer);
      await buyer.getByLabel('Кількість').fill('1');
      await buyer.getByLabel('Один продавець').check();
      await buyer.getByLabel({ SELF_PICKUP: 'Самовивіз', SELLER_DELIVERY: 'Доставка продавцем', POSTAL_DELIVERY: 'Поштова доставка' }[method]).check();
      if (radius) await buyer.getByLabel('Готовий їхати, км').fill(radius);
      await buyer.getByRole('button', { name: 'Опублікувати запит' }).click();
      await expect(buyer).toHaveURL(/\/map$/);
      const items = (await (await contexts[0].request.get('/api/buy-requests', { params: { mine: 'true' } })).json()).buyRequests;
      return items.find((item: { title: string }) => item.title === title).id as string;
    };
    const createProduct = async (title: string, method: 'SELF_PICKUP' | 'SELLER_DELIVERY', radius?: string) => {
      await seller.goto('/my/products/new');
      await seller.getByLabel('Назва товару').fill(title);
      await selectCategory(seller);
      await seller.getByLabel('Кількість').fill('10');
      await seller.getByLabel('Ціна за одиницю').fill('120');
      await seller.getByLabel(method === 'SELF_PICKUP' ? 'Самовивіз' : 'Доставка продавцем').check();
      if (radius) await seller.getByLabel('Радіус доставки, км').fill(radius);
      await seller.getByRole('button', { name: 'Опублікувати товар' }).click();
      await expect(seller).toHaveURL(/\/my\/products$/);
      const items = (await (await contexts[1].request.get('/api/products', { params: { mine: 'true' } })).json()).products;
      return items.find((item: { title: string }) => item.title === title).id as string;
    };
    const offer = async (requestId: string, productId: string, method: 'SELF_PICKUP' | 'SELLER_DELIVERY') => {
      await seller.goto(`/buy-requests/${requestId}`);
      await expect(seller.getByRole('button', { name: 'Запропонувати товар' })).toBeVisible();
      await seller.getByRole('button', { name: 'Запропонувати товар' }).click();
      const form = seller.locator('form.seller-offer-form');
      await form.getByLabel('Свій товар').check();
      await form.getByLabel('Мій активний товар').selectOption(productId);
      await form.getByRole('checkbox', { name: method === 'SELF_PICKUP' ? 'Самовивіз' : 'Доставка продавцем' }).check();
      await form.getByRole('button', { name: 'Переглянути умови' }).click();
      await form.getByRole('button', { name: 'Надіслати пропозицію' }).click();
      await expect(form).toHaveCount(0);
      return (await (await contexts[0].request.get(`/api/buy-requests/${requestId}/offers`)).json()).offers[0].deliveryCompatibility.status as string;
    };

    await place(0, 'Рівне', rivneCode, 50.6199, 26.2516);
    await place(1, 'Дубно', dubnoCode, 50.4166, 25.734);
    const pickupRequest = await createRequest(`Самовивіз ${stamp}`, 'SELF_PICKUP', '50');
    const pickupProduct = await createProduct(`Товар самовивіз ${stamp}`, 'SELF_PICKUP');
    expect(await offer(pickupRequest, pickupProduct, 'SELF_PICKUP')).toBe('EXACT_MATCH');

    await place(1, 'Луцьк', lutskCode, 50.747, 25.325);
    const deliveryProduct = await createProduct(`Товар доставка ${stamp}`, 'SELLER_DELIVERY', '20');
    const outRequest = await createRequest(`Поза радіусом ${stamp}`, 'SELLER_DELIVERY');
    expect(await offer(outRequest, deliveryProduct, 'SELLER_DELIVERY')).toBe('NO_MATCH');
    await place(0, 'Луцьк', lutskCode, 50.747, 25.325);
    const inRequest = await createRequest(`У радіусі ${stamp}`, 'SELLER_DELIVERY');
    expect(await offer(inRequest, deliveryProduct, 'SELLER_DELIVERY')).toBe('EXACT_MATCH');

    const postalRequest = await createRequest(`Гнучка пропозиція ${stamp}`, 'POSTAL_DELIVERY');
    await seller.goto(`/buy-requests/${postalRequest}`);
    await seller.getByRole('button', { name: 'Запропонувати товар' }).click();
    const flexibleForm = seller.locator('form.seller-offer-form');
    await flexibleForm.getByLabel('Вручну').check();
    await flexibleForm.getByLabel('Назва товару').fill(`Гнучкий товар ${stamp}`);
    await flexibleForm.getByLabel(/Ціна за/).fill('120');
    await flexibleForm.getByLabel('Можна домовитися').check();
    await flexibleForm.getByRole('button', { name: 'Переглянути умови' }).click();
    await flexibleForm.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    await expect(flexibleForm).toHaveCount(0);
    expect((await (await contexts[0].request.get(`/api/buy-requests/${postalRequest}/offers`)).json()).offers[0].deliveryCompatibility.status).toBe('POSSIBLE_AGREEMENT');
    await buyer.goto(`/buy-requests/${postalRequest}`);
    await buyer.getByText('Детальніше та інші дії').click();
    await expect(buyer.getByText('Можлива домовленість: умови отримання потрібно узгодити.')).toBeVisible();

    const agreedRequest = await createRequest(`Умови покупця ${stamp}`, 'POSTAL_DELIVERY');
    await seller.goto(`/buy-requests/${agreedRequest}`);
    await seller.getByRole('button', { name: 'Запропонувати товар' }).click();
    const agreedForm = seller.locator('form.seller-offer-form');
    await agreedForm.getByLabel('Погодитися з умовами покупця').check();
    await agreedForm.getByLabel(/Ціна за/).fill('130');
    await agreedForm.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await agreedForm.getByRole('button', { name: 'Переглянути умови' }).click();
    await agreedForm.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    await expect(agreedForm).toHaveCount(0);
    const agreedOffer = (await (await contexts[0].request.get(`/api/buy-requests/${agreedRequest}/offers`)).json()).offers[0];
    expect(agreedOffer.creationMode).toBe('request_terms');
    expect(agreedOffer.deliveryCompatibility.status).toBe('EXACT_MATCH');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    if (userIds.length) {
      if (!dbConnected) { await db.connect(); dbConnected = true; }
      await db.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [userIds]);
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]);
    }
    if (dbConnected) await db.end();
  }
});

test('Step 14: explicit map delivery filter keeps the ordinary catalogue available', async ({ browser }) => {
  test.setTimeout(240_000);
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.includes('step14_qa_')) throw new Error('Run only on isolated Step 14 QA database');
  const stamp = Date.now().toString(36);
  const context = await browser.newContext({ baseURL, viewport: { width: 1440, height: 900 } });
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  let userId: string | undefined;
  try {
    const username = `step14_map_${stamp}`;
    const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38066${String(Date.now()).slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } });
    expect(registered.status(), await registered.text()).toBe(201);
    userId = (await registered.json()).user.id;
    expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200);
    expect((await context.request.patch('/api/profile/me', { data: { location: 'Рівне', settlementCode: rivneCode, mapLocation: { mode: 'pin', latitude: 50.6199, longitude: 26.2516, consent: true } } })).status()).toBe(200);
    const category = ((await (await context.request.get('/api/categories')).json()).categories as { id: string; code: string }[]).find(item => item.code === 'grains')!;
    const productTitle = `Мапа пошта ${stamp}`;
    const product = await context.request.post('/api/products', { data: { categoryId: category.id, title: productTitle, quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }, { method: 'POSTAL_DELIVERY', nationwide: true }], geoZone: 'Рівне', settlementCode: rivneCode, latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active' } });
    expect(product.status(), await product.text()).toBe(201);
    const productId = (await product.json()).product.id as string;
    const request = await context.request.post('/api/buy-requests', { data: { categoryId: category.id, title: `Мапа продавець ${stamp}`, description: '', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: rivneCode, latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', countryCode: 'UA', deliveryOptions: [{ method: 'SELLER_DELIVERY' }], fulfillmentMode: 'single_seller' } });
    expect(request.status(), await request.text()).toBe(201);
    const requestId = (await request.json()).buyRequest.id as string;
    const page = await context.newPage();
    await page.goto('/map');
    const filter = page.getByLabel('Спосіб отримання');
    await expect(filter).toBeVisible();
    const postalResponse = page.waitForResponse(response => response.url().includes('/api/map/markers?') && response.url().includes('deliveryMethod=POSTAL_DELIVERY') && response.status() === 200);
    await filter.selectOption('POSTAL_DELIVERY');
    const postalMarkers = (await (await postalResponse).json()).markers as { id: string }[];
    expect(postalMarkers.some(marker => marker.id === productId)).toBe(true);
    expect(postalMarkers.some(marker => marker.id === requestId)).toBe(false);
    const sellerResponse = page.waitForResponse(response => response.url().includes('/api/map/markers?') && response.url().includes('deliveryMethod=SELLER_DELIVERY') && response.status() === 200);
    await filter.selectOption('SELLER_DELIVERY');
    const sellerMarkers = (await (await sellerResponse).json()).markers as { id: string }[];
    expect(sellerMarkers.some(marker => marker.id === productId)).toBe(false);
    expect(sellerMarkers.some(marker => marker.id === requestId), JSON.stringify({ url: (await sellerResponse).url(), requestId, markers: sellerMarkers })).toBe(true);
    const allResponse = page.waitForResponse(response => response.url().includes('/api/map/markers?') && !response.url().includes('deliveryMethod=') && response.status() === 200);
    await filter.selectOption('');
    const allMarkers = (await (await allResponse).json()).markers as { id: string }[];
    expect(allMarkers.some(marker => marker.id === productId)).toBe(true);
    expect(allMarkers.some(marker => marker.id === requestId)).toBe(true);
    await filter.selectOption('POSTAL_DELIVERY');
    await page.getByRole('button', { name: new RegExp(productTitle) }).first().click();
    await expect(page.getByRole('region', { name: 'Коротка інформація про оголошення' })).toContainText('Поштова доставка');
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Map filter overflow at ${width}`).toBe(true);
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.goto('/my/requests');
    await page.getByRole('button', { name: 'Редагувати' }).first().click();
    const editor = page.getByRole('dialog', { name: 'Редагувати запит' });
    await expect(editor.getByRole('checkbox', { name: 'Доставка продавцем' })).toBeChecked();
    await editor.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    await editor.getByRole('button', { name: 'Зберегти' }).click();
    await expect(editor).toHaveCount(0);
    const edited = (await (await context.request.get(`/api/buy-requests/${requestId}`)).json()).buyRequest;
    expect(edited.deliveryOptions).toEqual([{ method: 'SELLER_DELIVERY' }, { method: 'FLEXIBLE' }]);
  } finally {
    await context.close();
    if (userId) {
      await db.connect();
      await db.query('DELETE FROM users WHERE id=$1', [userId]);
      await db.end();
    }
  }
});
