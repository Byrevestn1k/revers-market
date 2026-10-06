import { expect, test } from '@playwright/test';
import { Client } from 'pg';

test('activity groups update after product, request and deal changes for a hybrid account', async ({ page }) => {
  test.setTimeout(300_000);
  const stamp = '2026-10-05T12:00:00.000Z';
  const products = [
    { id: 'active-product', title: 'Активна пшениця', status: 'active', updatedAt: stamp },
    { id: 'paused-product', title: 'Призупинений мед', status: 'paused', updatedAt: stamp },
    { id: 'sold-product', title: 'Продані яблука', status: 'sold', updatedAt: stamp },
  ].map(item => ({ ...item, category: { id: 'cat', name: 'Їжа' }, photos: [], quantity: 10, availableQuantity: 10, unit: 'kg', price: { amount: 100, currency: 'UAH' }, geoZone: 'Рівне', deliveryMode: 'pickup', owner: { id: 'hybrid', username: 'hybrid' } }));
  const requests = [
    { id: 'open-request', title: 'Потрібна пшениця', status: 'open', updatedAt: stamp },
    { id: 'done-request', title: 'Виконаний запит', status: 'completed', updatedAt: stamp },
    { id: 'cancelled-request', title: 'Скасований запит', status: 'cancelled', updatedAt: stamp },
  ].map(item => ({ ...item, category: { name: 'Їжа' }, geoArea: 'Рівне', quantity: 10, fulfilledQuantity: 0, selectedQuantity: 0, completedQuantity: 0, remainingQuantity: 10, fulfillmentMode: 'multiple_sellers', unit: 'kg', price: { min: 90, max: 120, currency: 'UAH' }, buyer: { id: 'hybrid', username: 'hybrid' } }));
  const offers = [
    { id: 'submitted-offer', buyRequestId: 'foreign-request', requestTitle: 'Потрібні яблука', requestStatus: 'open', status: 'submitted', acceptedQuantity: 0 },
    { id: 'accepted-offer', buyRequestId: 'completed-request', requestTitle: 'Потрібен мед', requestStatus: 'completed', status: 'accepted', acceptedQuantity: 5 },
    { id: 'completed-submitted-offer', buyRequestId: 'completed-without-selection', requestTitle: 'Виконаний запит із моєю пропозицією', requestStatus: 'completed', status: 'submitted', acceptedQuantity: 0 },
    { id: 'cancelled-submitted-offer', buyRequestId: 'cancelled-foreign-request', requestTitle: 'Скасований запит із моєю пропозицією', requestStatus: 'cancelled', status: 'submitted', acceptedQuantity: 0 },
    { id: 'expired-submitted-offer', buyRequestId: 'expired-foreign-request', requestTitle: 'Прострочений запит із моєю пропозицією', requestStatus: 'expired', status: 'submitted', acceptedQuantity: 0 },
  ].map(item => ({ ...item, seller: { id: 'hybrid', username: 'hybrid' }, existingProduct: null, quantity: 10, unit: 'kg', price: { amount: 100, currency: 'UAH' }, createdAt: stamp, updatedAt: stamp }));
  const orders = [
    { id: 'selected-deal', status: 'selected', buyer: { id: 'other', username: 'Покупець' }, seller: { id: 'hybrid', username: 'hybrid' }, buyRequestId: 'foreign-request' },
    { id: 'completed-deal', status: 'completed', buyer: { id: 'hybrid', username: 'hybrid' }, seller: { id: 'other', username: 'Продавець' }, buyRequestId: 'done-request' },
    { id: 'cancelled-deal', status: 'cancelled', buyer: { id: 'hybrid', username: 'hybrid' }, seller: { id: 'other', username: 'Продавець' }, buyRequestId: 'cancelled-request' },
  ].map(item => ({ ...item, quantity: 5, unit: 'kg', price: { unit: 100, currency: 'UAH' }, subtotal: 500, conditionsSnapshot: { productTitle: item.id }, createdAt: stamp, updatedAt: stamp }));

  await page.route('**/api/**', async route => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    const method = route.request().method();
    let json: any = {};
    if (path === '/api/auth/me') json = { user: { id: 'hybrid', username: 'hybrid' } };
    else if (path === '/api/categories') json = { categories: [] };
    else if (path === '/api/profile/me') json = { profile: { id: 'hybrid', avatarUrl: null } };
    else if (path === '/api/notifications') json = { notifications: [], unreadCounts: { total: 0, buying: 0, selling: 0 } };
    else if (path === '/api/conversations') json = { conversations: [] };
    else if (path === '/api/products/mine') json = { products: url.searchParams.get('page') === '2' ? products.slice(2) : products.slice(0, 2), pagination: { page: Number(url.searchParams.get('page')), pages: 2 } };
    else if (path === '/api/products') json = { products: [], pagination: { page: 1, pages: 1 } };
    else if (path.startsWith('/api/products/') && method === 'PATCH') { products.find(item => item.id === path.split('/')[3])!.status = route.request().postDataJSON().status; json = { product: {} }; }
    else if (path === '/api/buy-requests' && url.searchParams.get('mine') === 'true') json = { buyRequests: url.searchParams.get('page') === '2' ? requests.slice(1) : requests.slice(0, 1), pagination: { page: Number(url.searchParams.get('page')), pages: 2 } };
    else if (path === '/api/buy-requests') json = { buyRequests: [] };
    else if (path.startsWith('/api/buy-requests/') && method === 'PATCH') { requests.find(item => item.id === path.split('/')[3])!.status = route.request().postDataJSON().status; json = { buyRequest: {} }; }
    else if (path === '/api/offers/mine') json = { offers: url.searchParams.get('page') === '2' ? offers.slice(1) : offers.slice(0, 1), pagination: { page: Number(url.searchParams.get('page')), pages: 2 } };
    else if (path === '/api/orders') json = { orders };
    else if (path === '/api/orders/selected-deal/seller-confirm') { orders[0].status = 'in_progress'; json = { order: orders[0] }; }
    await route.fulfill({ json });
  });

  await page.goto('/my/products', { waitUntil: 'domcontentloaded' });
  const productTabs = page.getByRole('navigation', { name: 'Стан активності' });
  await expect(productTabs.getByRole('button', { name: 'Активні 1', exact: true })).toBeVisible();
  await productTabs.getByRole('button', { name: 'Неактивні 1', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(1);
  await expect(page.locator('.product-card')).toContainText('Призупинений мед');
  await page.locator('.product-card').getByRole('combobox', { name: 'Статус' }).selectOption('active');
  await expect(productTabs.getByRole('button', { name: 'Активні 2', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Неактивних товарів немає' })).toBeVisible();
  await page.reload();
  await expect(productTabs.getByRole('button', { name: 'Активні 2', exact: true })).toBeVisible();
  await productTabs.getByRole('button', { name: 'Усі 3', exact: true }).click();
  await expect(page.locator('.product-card')).toHaveCount(3);

  await page.goto('/my/requests', { waitUntil: 'domcontentloaded' });
  const requestTabs = page.getByRole('navigation', { name: 'Стан активності' });
  await expect(requestTabs.getByRole('button', { name: 'Активні 1', exact: true })).toBeVisible();
  await page.locator('.request-card').filter({ hasText: 'Потрібна пшениця' }).getByRole('button', { name: 'Закрити запит' }).click();
  await page.getByRole('dialog').getByRole('button', { name: 'Закрити запит' }).click();
  await expect(requestTabs.getByRole('button', { name: 'Активні 0', exact: true })).toBeVisible();
  await requestTabs.getByRole('button', { name: 'Скасовані 2', exact: true }).click();
  await expect(page.locator('.request-card')).toHaveCount(2);
  await expect(page.locator('.request-card').filter({ hasText: 'Потрібна пшениця' })).toHaveCount(1);
  await requestTabs.getByRole('button', { name: 'Усі 3', exact: true }).click();
  await expect(page.locator('.request-card')).toHaveCount(3);

  await page.goto('/requests', { waitUntil: 'domcontentloaded' });
  const offerTabs = page.getByRole('navigation', { name: 'Стан активності' });
  await expect(offerTabs.getByRole('button', { name: 'Очікують 1', exact: true })).toBeVisible();
  const waitingOffer = page.locator('.activity-tabs + .request-list .request-card');
  await expect(waitingOffer).toHaveCount(1);
  await expect(waitingOffer.getByRole('button', { name: 'Редагувати' })).toBeVisible();
  await expect(waitingOffer).not.toContainText('Виконаний запит із моєю пропозицією');
  await offerTabs.getByRole('button', { name: 'Інші 3', exact: true }).click();
  const historicalOffers = page.locator('.activity-tabs + .request-list .request-card');
  await expect(historicalOffers).toHaveCount(3);
  const completedSubmitted = historicalOffers.filter({ hasText: 'Виконаний запит із моєю пропозицією' });
  await expect(completedSubmitted).toContainText('Запит: Виконаний');
  await expect(completedSubmitted.getByRole('button', { name: 'Редагувати' })).toHaveCount(0);
  await completedSubmitted.getByRole('link', { name: 'Виконаний запит із моєю пропозицією' }).click();
  await expect(page).toHaveURL('/requests?offer=completed-submitted-offer');
  await expect(page.getByLabel('Історія власної пропозиції')).toContainText('Виконаний', { timeout: 30_000 });
  await page.goBack();
  await offerTabs.getByRole('button', { name: 'Інші 3', exact: true }).click();
  const cancelledSubmitted = historicalOffers.filter({ hasText: 'Скасований запит із моєю пропозицією' });
  await expect(cancelledSubmitted).toContainText('Запит: Скасований');
  await expect(cancelledSubmitted.getByRole('button', { name: 'Редагувати' })).toHaveCount(0);
  await cancelledSubmitted.getByRole('link', { name: 'Скасований запит із моєю пропозицією' }).click();
  await expect(page).toHaveURL('/requests?offer=cancelled-submitted-offer');
  await expect(page.getByLabel('Історія власної пропозиції')).toContainText('Скасований запит із моєю пропозицією', { timeout: 30_000 });
  await expect(page.getByLabel('Історія власної пропозиції')).toContainText('Скасований');
  await expect(page.getByRole('button', { name: 'Закрити запит' })).toHaveCount(0);
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `horizontal overflow at ${width}px`).toBeLessThanOrEqual(width);
    await expect(page.getByLabel('Історія власної пропозиції')).toBeVisible();
  }
  await page.goBack();
  await expect(page).toHaveURL('/requests');
  await offerTabs.getByRole('button', { name: 'Обрані 1', exact: true }).click();
  const chosen = page.locator('.activity-tabs + .request-list .request-card');
  await expect(chosen).toHaveCount(1);
  await expect(chosen.getByRole('link', { name: 'Потрібен мед' })).toHaveAttribute('href', '/requests?offer=accepted-offer');
  await expect(chosen.getByRole('button', { name: 'Відкликати' })).toHaveCount(0);
  await expect(chosen.getByRole('link', { name: /пов’язані угоди/ })).toHaveAttribute('href', '/orders');
  await chosen.getByRole('link', { name: /пов’язані угоди/ }).click();
  await expect(page).toHaveURL('/orders');
  await page.goBack();
  await offerTabs.getByRole('button', { name: 'Усі 5', exact: true }).click();
  await expect(page.locator('.activity-tabs + .request-list .request-card')).toHaveCount(5);

  await page.goto('/orders', { waitUntil: 'domcontentloaded' });
  const dealTabs = page.getByRole('navigation', { name: 'Стан активності' });
  await expect(dealTabs.getByRole('button', { name: 'Потребують дії 1', exact: true })).toBeVisible();
  const selected = page.locator('.order-card').filter({ hasText: 'selected-deal' });
  await expect(selected).toContainText('Продаю · покупець Покупець');
  await selected.getByRole('button', { name: 'Підтвердити домовленість' }).click();
  await expect(dealTabs.getByRole('button', { name: 'Потребують дії 0', exact: true })).toBeVisible();
  await dealTabs.getByRole('button', { name: 'У процесі 1', exact: true }).click();
  await expect(page.locator('.order-card')).toHaveCount(1);
  await expect(page.locator('.order-card')).toContainText('selected-deal');
  await page.reload();
  await expect(dealTabs.getByRole('button', { name: 'У процесі 1', exact: true })).toBeVisible();
  await dealTabs.getByRole('button', { name: 'Усі 3', exact: true }).click();
  await expect(page.locator('.order-card')).toHaveCount(3);
});

test('request loading and API failure never appear as an empty activity group, and retry recovers', async ({ page }) => {
  let attempts = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/buy-requests') {
      attempts += 1;
      if (attempts === 1) { await route.fulfill({ status: 503, json: { message: 'Тимчасова помилка' } }); return; }
      await route.fulfill({ json: { buyRequests: [{ id: 'recovered', title: 'Відновлений запит', status: 'open', category: { name: 'Їжа' }, geoArea: 'Рівне', quantity: 1, unit: 'kg', fulfillmentMode: 'single_seller', price: { min: 1, max: 2, currency: 'UAH' }, offerCount: 2 }], pagination: { page: 1, pages: 1 } } });
      return;
    }
    const json = path === '/api/auth/me' ? { user: { id: 'hybrid', username: 'hybrid' } } : path === '/api/categories' ? { categories: [] } : path === '/api/products/mine' ? { products: [], pagination: { page: 1, pages: 1 } } : path === '/api/products' ? { products: [], pagination: { page: 1, pages: 1 } } : path === '/api/profile/me' ? { profile: { id: 'hybrid' } } : path === '/api/notifications' ? { unreadCounts: { total: 0, buying: 0, selling: 0 }, notifications: [] } : path === '/api/conversations' ? { conversations: [] } : {};
    await route.fulfill({ json });
  });
  await page.goto('/my/requests');
  await expect(page.getByRole('alert')).toContainText('Тимчасова помилка');
  await expect(page.getByText('У вас ще немає запитів')).toHaveCount(0);
  await page.getByRole('button', { name: 'Спробувати ще раз' }).click();
  await expect(page.getByRole('navigation', { name: 'Стан активності' }).getByRole('button', { name: 'Активні 1', exact: true })).toBeVisible();
  await expect(page.locator('.request-card')).toContainText('Відновлений запит');
  await expect(page.locator('.request-card').getByRole('button', { name: 'Пропозиції (2)' })).toBeVisible();
});

test('real database keeps terminal seller offers historical and private', async ({ browser }) => {
  test.skip(!process.env.DATABASE_URL, 'requires the configured local database');
  test.setTimeout(180_000);
  const base = 'http://127.0.0.1:5173';
  const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const users = ['b', 's1', 's2'].map((role, index) => ({ username: `ui_history_${role}_${suffix}`, email: `ui_history_${role}_${suffix}@example.com`, countryCode: 'UA', phone: `+380${['50', '63', '67'][index]}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' }));
  const contexts = await Promise.all(users.map(() => browser.newContext({ baseURL: base })));
  const [buyer, seller, otherSeller] = contexts;
  const post = (context: typeof buyer, path: string, data: object) => context.request.post(base + path, { data });
  const createRequest = async (title: string, categoryId: string) => {
    const response = await post(buyer, '/api/buy-requests', { categoryId, title, description: 'Приватний опис покупця', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 100, maxPrice: 200, delivery: 'no', geoArea: 'Київська область', address: 'Приватна адреса покупця' });
    expect(response.status()).toBe(201);
    return (await response.json()).buyRequest.id as string;
  };
  const createOffer = async (context: typeof seller, requestId: string, quantity = 5) => {
    const response = await post(context, `/api/buy-requests/${requestId}/offers`, { quantity, unit: 'kg', price: 150, currency: 'UAH', delivery: 'Самовивіз' });
    expect(response.status()).toBe(201);
    return (await response.json()).offer.id as string;
  };
  try {
    for (const [index, context] of contexts.entries()) expect((await post(context, '/api/auth/register', users[index])).status()).toBe(201);
    const categories = (await (await buyer.request.get(base + '/api/categories')).json()).categories;
    const categoryId = categories.find((item: { code: string }) => item.code === 'grains').id;
    const activeId = await createRequest('Активний історичний тест', categoryId);
    await createOffer(seller, activeId);
    const completedId = await createRequest('Виконаний історичний тест', categoryId);
    await createOffer(seller, completedId);
    const selectedOfferId = await createOffer(otherSeller, completedId, 10);
    const selected = await post(buyer, `/api/offers/${selectedOfferId}/accept`, { quantity: 10 });
    expect(selected.status()).toBe(201);
    const orderId = (await selected.json()).order.id;
    expect((await post(otherSeller, `/api/orders/${orderId}/seller-confirm`, {})).status()).toBe(200);
    expect((await post(buyer, `/api/orders/${orderId}/complete`, {})).status()).toBe(200);
    expect((await post(otherSeller, `/api/orders/${orderId}/complete`, {})).status()).toBe(200);
    const cancelledId = await createRequest('Скасований історичний тест', categoryId);
    const cancelledOfferId = await createOffer(seller, cancelledId);
    expect((await buyer.request.patch(base + `/api/buy-requests/${cancelledId}`, { data: { status: 'cancelled' } })).status()).toBe(200);
    const expiredId = await createRequest('Прострочений історичний тест', categoryId);
    await createOffer(seller, expiredId);
    expect((await buyer.request.patch(base + `/api/buy-requests/${expiredId}`, { data: { status: 'expired' } })).status()).toBe(200);

    const ownOffers = (await (await seller.request.get(base + '/api/offers/mine')).json()).offers;
    expect(ownOffers).toHaveLength(4);
    expect(ownOffers.find((offer: { id: string }) => offer.id === cancelledOfferId)).toMatchObject({ requestTitle: 'Скасований історичний тест', requestStatus: 'cancelled', status: 'submitted' });
    expect(ownOffers[0]).not.toHaveProperty('requestDescription');
    expect(ownOffers[0]).not.toHaveProperty('address');
    expect((await otherSeller.request.get(base + `/api/buy-requests/${cancelledId}/offers`)).status()).toBe(403);
    expect((await otherSeller.request.get(base + '/api/offers/mine').then(response => response.json())).offers.map((offer: { id: string }) => offer.id)).not.toContain(cancelledOfferId);
    expect((await seller.request.get(base + `/api/buy-requests/${cancelledId}`)).status()).toBe(404);
    expect((await buyer.request.get(base + `/api/buy-requests/${cancelledId}`)).status()).toBe(200);

    const sellerPage = await seller.newPage();
    await sellerPage.goto('/requests');
    const tabs = sellerPage.getByRole('navigation', { name: 'Стан активності' });
    await expect(tabs.getByRole('button', { name: 'Очікують 1', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Інші 3', exact: true })).toBeVisible();
    await expect(tabs.getByRole('button', { name: 'Усі 4', exact: true })).toBeVisible();
    await expect(sellerPage.locator('.activity-tabs + .request-list .request-card').getByRole('button', { name: 'Редагувати' })).toBeVisible();
    await tabs.getByRole('button', { name: 'Інші 3', exact: true }).click();
    const historical = sellerPage.locator('.activity-tabs + .request-list .request-card');
    await expect(historical).toHaveCount(3);
    await expect(historical.getByRole('button', { name: 'Редагувати' })).toHaveCount(0);
    await historical.getByRole('link', { name: 'Скасований історичний тест' }).click();
    await expect(sellerPage).toHaveURL(`/requests?offer=${cancelledOfferId}`);
    await expect(sellerPage.getByLabel('Історія власної пропозиції')).toContainText('Скасований');
    await expect(sellerPage.getByText('Приватна адреса покупця')).toHaveCount(0);
    await sellerPage.goBack();
    await expect(sellerPage).toHaveURL('/requests');

    const selectedPage = await otherSeller.newPage();
    await selectedPage.goto('/requests');
    await expect(selectedPage.getByRole('navigation', { name: 'Стан активності' }).getByRole('button', { name: 'Обрані 1', exact: true })).toBeVisible();
    await expect(selectedPage.locator('.activity-tabs + .request-list .request-card').getByRole('link', { name: /пов’язані угоди/ })).toHaveAttribute('href', '/orders');
  } finally {
    await Promise.all(contexts.map(context => context.close()));
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      const names = users.map(user => user.username.toLowerCase());
      await db.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [names]);
      await db.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [names]);
    } finally { await db.end(); }
  }
});
