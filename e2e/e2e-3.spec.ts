import { expect, test, type APIResponse, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { Client } from 'pg';
import { randomUUID } from 'node:crypto';

const password = 'StrongPassword1';
const desktop = { width: 1440, height: 900 };

type Actor = {
  context: BrowserContext;
  page: Page;
  userId: string;
  username: string;
};

type Scenario = {
  actors: { buyer: Actor; sellerA: Actor; sellerB: Actor };
  requestId: string;
  title: string;
  orderA: string;
  orderB: string;
};

type Order = {
  id: string;
  status: string;
  quantity: number;
  subtotal: number;
  buyerCompletedAt: string | null;
  sellerCompletedAt: string | null;
  actualQuantity: number | null;
  actualTotal: number | null;
};

type BuyRequest = {
  status: string;
  quantity: number;
  selectedQuantity: number;
  completedQuantity: number;
  remainingQuantity: number;
};

const json = async <T>(response: APIResponse, expectedStatus: number): Promise<T> => {
  const body = await response.json();
  expect(response.status(), JSON.stringify(body)).toBe(expectedStatus);
  return body as T;
};

const createActor = async (browser: Browser, role: string, runId: string, phoneSuffix: string): Promise<Actor> => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173', viewport: desktop });
  const username = `e3_${role}_${runId}`;
  const response = await context.request.post('/api/auth/register', {
    data: {
      username,
      email: `${username}@example.com`,
      countryCode: 'UA',
      phone: `+38067${phoneSuffix}`,
      password,
      passwordConfirmation: password,
    },
  });
  const body = await json<{ user: { id: string } }>(response, 201);
  return { context, page: await context.newPage(), userId: body.user.id, username };
};

const cleanupActors = async (actors: Actor[]) => {
  await Promise.allSettled(actors.map(actor => actor.context.close()));
  if (!actors.length) return;
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const ids = actors.map(actor => actor.userId);
    await client.query('BEGIN');
    await client.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [ids]);
    await client.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    await client.end();
  }
};

const createScenario = async (browser: Browser): Promise<Scenario> => {
  const stamp = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const runId = stamp.slice(-12);
  const phoneBase = String(Date.now()).slice(-6);
  const actors: Actor[] = [];
  try {
    const buyer = await createActor(browser, 'buyer', runId, `1${phoneBase}`); actors.push(buyer);
    const sellerA = await createActor(browser, 'sellera', runId, `2${phoneBase}`); actors.push(sellerA);
    const sellerB = await createActor(browser, 'sellerb', runId, `3${phoneBase}`); actors.push(sellerB);
    const title = `E2E3 Мед ${runId}`;

    const categoryResponse = await buyer.context.request.get('/api/categories');
    const categories = await json<{ categories: Array<{ id: string; code: string }> }>(categoryResponse, 200);
    const categoryId = categories.categories.find(category => category.code === 'grains')?.id ?? categories.categories[0].id;

    const requestResponse = await buyer.context.request.post('/api/buy-requests', {
      data: {
        categoryId,
        title,
        description: 'Automated E2E №3 regression fixture',
        delivery: 'no',
        minPrice: 150,
        maxPrice: 220,
        quantity: 20,
        unit: 'kg',
        currency: 'UAH',
        geoArea: 'Рівне',
        latitude: 50.6199,
        longitude: 26.2516,
        fulfillmentMode: 'multiple_sellers',
      },
    });
    const createdRequest = await json<{ buyRequest: { id: string } }>(requestResponse, 201);
    const requestId = createdRequest.buyRequest.id;

    const offerAResponse = await sellerA.context.request.post(`/api/buy-requests/${requestId}/offers`, {
      data: { quantity: 8, unit: 'kg', price: 175, currency: 'UAH', delivery: 'Самовивіз, Рівне', note: 'E2E №3 Offer A' },
    });
    const offerA = await json<{ offer: { id: string } }>(offerAResponse, 201);
    const offerBResponse = await sellerB.context.request.post(`/api/buy-requests/${requestId}/offers`, {
      data: { quantity: 12, unit: 'kg', price: 195, currency: 'UAH', delivery: 'Самовивіз, Рівне', note: 'E2E №3 Offer B' },
    });
    const offerB = await json<{ offer: { id: string } }>(offerBResponse, 201);

    const orderAResponse = await buyer.context.request.post(`/api/offers/${offerA.offer.id}/accept`, {
      data: { quantity: 8, selectionKey: randomUUID() },
    });
    const orderA = await json<{ order: { id: string } }>(orderAResponse, 201);
    const orderBResponse = await buyer.context.request.post(`/api/offers/${offerB.offer.id}/accept`, {
      data: { quantity: 12, selectionKey: randomUUID() },
    });
    const orderB = await json<{ order: { id: string } }>(orderBResponse, 201);

    return { actors: { buyer, sellerA, sellerB }, requestId, title, orderA: orderA.order.id, orderB: orderB.order.id };
  } catch (error) {
    await cleanupActors(actors);
    throw error;
  }
};

const cleanupScenario = async (scenario: Scenario | undefined) => {
  if (!scenario) return;
  await cleanupActors(Object.values(scenario.actors));
};

const getOrder = async (actor: Actor, orderId: string): Promise<Order> => {
  const response = await actor.context.request.get(`/api/orders/${orderId}`);
  return (await json<{ order: Order }>(response, 200)).order;
};

const getRequest = async (actor: Actor, requestId: string): Promise<BuyRequest> => {
  const response = await actor.context.request.get(`/api/buy-requests/${requestId}`);
  return (await json<{ buyRequest: BuyRequest }>(response, 200)).buyRequest;
};

const openOrders = async (actor: Actor, scope: 'active' | 'completed' = 'active') => {
  await actor.page.goto('/?view=orders');
  await expect(actor.page.getByRole('heading', { name: 'Мої домовленості' })).toBeVisible();
  if (scope === 'completed') await actor.page.getByRole('button', { name: 'Завершені' }).click();
};

const dealCard = (actor: Actor, title: string, counterpart: string) => actor.page
  .getByRole('article')
  .filter({ hasText: title })
  .filter({ hasText: counterpart });

const completeFromUi = async (actor: Actor, card: ReturnType<typeof dealCard>) => {
  await card.getByRole('button', { name: '✔ Угода відбулася' }).click();
  const dialog = actor.page.getByRole('dialog', { name: 'Підтвердити результат угоди' });
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Підтвердити' }).click();
};

const createCompletedReviewDeal = async (buyer: Actor, seller: Actor, suffix: string) => {
  const categories = await json<{ categories: Array<{ id: string; code: string }> }>(await buyer.context.request.get('/api/categories'), 200);
  const categoryId = categories.categories.find(category => category.code === 'grains')?.id ?? categories.categories[0].id;
  const title = `E2E3 review viewport ${suffix}`;
  const buyRequest = await json<{ buyRequest: { id: string } }>(await buyer.context.request.post('/api/buy-requests', { data: { categoryId, title, description: '', delivery: 'no', minPrice: 1, maxPrice: 10, quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', fulfillmentMode: 'single_seller' } }), 201);
  const offer = await json<{ offer: { id: string } }>(await seller.context.request.post(`/api/buy-requests/${buyRequest.buyRequest.id}/offers`, { data: { quantity: 1, unit: 'kg', price: 5, currency: 'UAH', delivery: 'Самовивіз' } }), 201);
  const order = await json<{ order: { id: string } }>(await buyer.context.request.post(`/api/offers/${offer.offer.id}/accept`, { data: { quantity: 1, selectionKey: randomUUID() } }), 201);
  await json(await seller.context.request.post(`/api/orders/${order.order.id}/seller-confirm`), 200);
  await json(await buyer.context.request.post(`/api/orders/${order.order.id}/complete`, { data: {} }), 200);
  await json(await seller.context.request.post(`/api/orders/${order.order.id}/complete`, { data: {} }), 200);
  return title;
};

const submitReview = async (actor: Actor, card: ReturnType<typeof dealCard>, rating: number, body: string, buyerReview: boolean) => {
  await card.getByRole('button', { name: 'Залишити відгук' }).click();
  await expect(card.getByText(/Відгук про (продавця|покупця):/)).toBeVisible();
  await card.getByLabel('Загальна оцінка (1–12)').selectOption(String(rating));
  await card.getByLabel('Спілкування (1–12)').selectOption(String(rating));
  await card.getByLabel('Дотримання домовленостей (1–12)').selectOption(String(rating));
  if (buyerReview) await card.getByLabel('Товар відповідав опису (1–12)').selectOption(String(rating));
  await card.getByLabel('Коментар').fill(body);
  await card.getByRole('button', { name: 'Залишити відгук' }).last().click();
  await expect(card.getByText('Ваш відгук збережено.')).toBeVisible();
  await expect(card.getByRole('button', { name: 'Залишити відгук' })).toHaveCount(0);
};

const rating = async (actor: Actor, username: string) => {
  const response = await actor.context.request.get(`/api/profiles/${username}`);
  const body = await json<{ profile: { ratingSummary: { average: number | null; count: number } } }>(response, 200);
  return body.profile.ratingSummary;
};

const reviews = async (actor: Actor, username: string) => {
  const response = await actor.context.request.get(`/api/profiles/${username}/reviews`);
  return (await json<{ reviews: Array<{ orderId: string; rating: number }> }>(response, 200)).reviews;
};

const notifications = async (actor: Actor) => {
  const response = await actor.context.request.get('/api/notifications');
  return (await json<{ notifications: Array<{ orderId: string | null; conversationId: string | null; type: string; title: string }> }>(response, 200)).notifications;
};

const assertNoHorizontalOverflow = async (page: Page) => {
  const dimensions = await page.evaluate(() => ({ clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
  expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.clientWidth);
};

test('E2E №3: two partial Deals complete, publish reviews and preserve accounting', async ({ browser }) => {
  test.setTimeout(240_000);
  let scenario: Scenario | undefined;
  try {
    scenario = await createScenario(browser);
    const { buyer, sellerA, sellerB } = scenario.actors;

    await expect.poll(async () => getRequest(buyer, scenario!.requestId)).toMatchObject({
      quantity: 20,
      selectedQuantity: 20,
      completedQuantity: 0,
      remainingQuantity: 0,
    });
    await buyer.page.goto(`/buy-requests/${scenario.requestId}`);
    await expect(buyer.page.getByRole('heading', { level: 1, name: scenario.title })).toBeVisible();
    await expect(buyer.page.getByText('Пропонує 8 кг')).toBeVisible();
    await expect(buyer.page.getByText('Пропонує 12 кг')).toBeVisible();

    expect((await sellerB.context.request.post(`/api/orders/${scenario.orderA}/seller-confirm`)).status()).toBe(403);
    expect((await sellerB.context.request.post(`/api/orders/${scenario.orderA}/complete`, { data: {} })).status()).toBe(403);
    expect((await sellerB.context.request.post(`/api/orders/${scenario.orderA}/reviews`, { data: { rating: 1 } })).status()).toBe(403);
    expect((await buyer.context.request.post(`/api/orders/${scenario.orderA}/reviews`, { data: { rating: 10 } })).status()).toBe(409);
    await openOrders(sellerB);
    await expect(dealCard(sellerB, scenario.title, sellerA.username)).toHaveCount(0);
    await expect(dealCard(sellerB, scenario.title, buyer.username)).toBeVisible();

    await openOrders(sellerA);
    let cardA = dealCard(sellerA, scenario.title, buyer.username);
    await expect(cardA).toContainText('8 kg');
    await expect(cardA).toContainText('175 UAH / kg');
    await expect(cardA).toContainText('1 400 UAH');
    await cardA.getByRole('button', { name: 'Підтвердити домовленість' }).click();
    await expect.poll(async () => (await getOrder(sellerA, scenario!.orderA)).status).toBe('in_progress');
    await completeFromUi(sellerA, cardA);
    await expect.poll(async () => (await getOrder(sellerA, scenario!.orderA)).status).toBe('seller_marked_completed');
    await expect(cardA.getByRole('button', { name: '✔ Угода відбулася' })).toHaveCount(0);
    await expect(cardA).toContainText('Очікуємо покупця');

    await openOrders(buyer);
    cardA = dealCard(buyer, scenario.title, sellerA.username);
    await expect(cardA).toContainText('Очікує покупця');
    await completeFromUi(buyer, cardA);
    await expect.poll(async () => (await getOrder(buyer, scenario!.orderA)).status).toBe('completed');
    const completedA = await getOrder(buyer, scenario.orderA);
    expect(completedA).toMatchObject({ quantity: 8, subtotal: 1400, actualQuantity: 8, actualTotal: 1400 });
    expect(completedA.buyerCompletedAt).toBeTruthy();
    expect(completedA.sellerCompletedAt).toBeTruthy();

    await expect.poll(async () => getRequest(buyer, scenario!.requestId)).toMatchObject({
      quantity: 20,
      completedQuantity: 8,
      selectedQuantity: 12,
      remainingQuantity: 0,
    });
    expect((await getOrder(buyer, scenario.orderB)).status).toBe('selected');
    await buyer.page.goto('/?view=requests');
    const requestCard = buyer.page.getByRole('article').filter({ hasText: scenario.title });
    await expect(requestCard).toContainText('Потрібно: 20 kg');
    await expect(requestCard).toContainText('Домовлено: 12 kg');
    await expect(requestCard).toContainText('Отримано: 8 kg');
    await expect(requestCard).toContainText('Ще можна обрати: 0 kg');

    await openOrders(buyer, 'completed');
    cardA = dealCard(buyer, scenario.title, sellerA.username);
    await submitReview(buyer, cardA, 10, 'Automated E2E Deal A buyer review', true);
    expect(await rating(buyer, sellerA.username)).toEqual({ average: null, count: 0 });
    expect((await reviews(buyer, sellerA.username)).some(review => review.orderId === scenario!.orderA)).toBe(false);

    await openOrders(sellerA, 'completed');
    cardA = dealCard(sellerA, scenario.title, buyer.username);
    await expect(cardA).toContainText('Інша сторона вже залишила відгук');
    await submitReview(sellerA, cardA, 11, 'Automated E2E Deal A seller review', false);
    expect(await rating(buyer, sellerA.username)).toEqual({ average: 10, count: 1 });
    expect(await rating(sellerA, buyer.username)).toEqual({ average: 11, count: 1 });
    expect((await reviews(buyer, sellerA.username)).find(review => review.orderId === scenario!.orderA)?.rating).toBe(10);
    expect((await reviews(sellerA, buyer.username)).find(review => review.orderId === scenario!.orderA)?.rating).toBe(11);

    await openOrders(sellerB);
    let cardB = dealCard(sellerB, scenario.title, buyer.username);
    await expect(cardB).toContainText('12 kg');
    await expect(cardB).toContainText('195 UAH / kg');
    await expect(cardB).toContainText('2 340 UAH');
    await cardB.getByRole('button', { name: 'Підтвердити домовленість' }).click();
    await expect.poll(async () => (await getOrder(sellerB, scenario!.orderB)).status).toBe('in_progress');

    await openOrders(buyer);
    cardB = dealCard(buyer, scenario.title, sellerB.username);
    await completeFromUi(buyer, cardB);
    await expect.poll(async () => (await getOrder(buyer, scenario!.orderB)).status).toBe('buyer_marked_completed');
    expect((await getRequest(buyer, scenario.requestId)).completedQuantity).toBe(8);
    await expect(cardB.getByRole('button', { name: '✔ Угода відбулася' })).toHaveCount(0);

    await openOrders(sellerB);
    cardB = dealCard(sellerB, scenario.title, buyer.username);
    await expect(cardB).toContainText('Очікує продавця');
    await completeFromUi(sellerB, cardB);
    await expect.poll(async () => (await getOrder(sellerB, scenario!.orderB)).status).toBe('completed');
    const completedB = await getOrder(sellerB, scenario.orderB);
    expect(completedB).toMatchObject({ quantity: 12, subtotal: 2340, actualQuantity: 12, actualTotal: 2340 });
    expect(completedB.buyerCompletedAt).toBeTruthy();
    expect(completedB.sellerCompletedAt).toBeTruthy();

    await expect.poll(async () => getRequest(buyer, scenario!.requestId)).toMatchObject({
      status: 'completed',
      quantity: 20,
      completedQuantity: 20,
      selectedQuantity: 0,
      remainingQuantity: 0,
    });
    await buyer.page.goto(`/buy-requests/${scenario.requestId}`);
    await expect(buyer.page.getByText('Отримано: 20')).toBeVisible();
    await expect(buyer.page.getByText('Домовлено: 0')).toBeVisible();
    await expect(buyer.page.getByText('0 кг', { exact: true })).toBeVisible();
    const selectButtons = buyer.page.getByRole('button', { name: 'Обрати пропозицію' });
    await expect(selectButtons).toHaveCount(2);
    for (const button of await selectButtons.all()) await expect(button).toBeDisabled();

    await openOrders(sellerB, 'completed');
    cardB = dealCard(sellerB, scenario.title, buyer.username);
    await submitReview(sellerB, cardB, 9, 'Automated E2E Deal B seller review', false);
    expect(await rating(sellerB, buyer.username)).toEqual({ average: 11, count: 1 });
    expect(await rating(buyer, sellerA.username)).toEqual({ average: 10, count: 1 });

    await openOrders(buyer, 'completed');
    cardB = dealCard(buyer, scenario.title, sellerB.username);
    await submitReview(buyer, cardB, 12, 'Automated E2E Deal B buyer review', true);
    expect(await rating(buyer, buyer.username)).toEqual({ average: 10, count: 2 });
    expect(await rating(buyer, sellerA.username)).toEqual({ average: 10, count: 1 });
    expect(await rating(buyer, sellerB.username)).toEqual({ average: 12, count: 1 });
    expect((await reviews(buyer, sellerB.username)).find(review => review.orderId === scenario!.orderB)?.rating).toBe(12);
    expect((await reviews(buyer, buyer.username)).filter(review => [scenario!.orderA, scenario!.orderB].includes(review.orderId)).map(review => review.rating).sort((left, right) => left - right)).toEqual([9, 11]);

    const buyerNotifications = await notifications(buyer);
    const sellerANotifications = await notifications(sellerA);
    const sellerBNotifications = await notifications(sellerB);
    for (const orderId of [scenario.orderA, scenario.orderB]) {
      expect(buyerNotifications.filter(item => item.orderId === orderId && item.title === 'Домовленість підтверджена')).toHaveLength(1);
    }
    expect(buyerNotifications.filter(item => item.orderId === scenario.orderA && item.title === 'Підтвердьте результат угоди')).toHaveLength(1);
    expect(sellerBNotifications.filter(item => item.orderId === scenario.orderB && item.title === 'Підтвердьте результат угоди')).toHaveLength(1);
    expect(sellerANotifications.filter(item => item.orderId === scenario.orderA && item.title === 'Угоду підтверджено обома сторонами')).toHaveLength(1);
    expect(buyerNotifications.filter(item => item.orderId === scenario.orderB && item.title === 'Угоду підтверджено обома сторонами')).toHaveLength(1);
    expect(buyerNotifications.filter(item => [scenario!.orderA, scenario!.orderB].includes(item.orderId ?? '') && item.type === 'review').length).toBeGreaterThanOrEqual(2);

    await buyer.page.goto('/');
    await buyer.page.getByRole('button', { name: /Сповіщення/ }).last().click();
    const dealBConversationId = buyerNotifications.find(item => item.orderId === scenario!.orderB && item.conversationId)?.conversationId;
    const dealBNotification = buyerNotifications.find(item => item.orderId === scenario!.orderB && item.conversationId);
    expect(dealBConversationId).toBeTruthy();
    expect(dealBNotification).toBeTruthy();
    await buyer.page.getByRole('tab', { name: /Купівля/ }).click();
    await buyer.page.getByRole('article').filter({ hasText: dealBNotification?.title ?? '' }).getByRole('button', { name: 'Переглянути' }).first().click();
    await expect(buyer.page).toHaveURL(`/messages/${dealBConversationId}`);
  } finally {
    await cleanupScenario(scenario);
  }
});

test('E2E №3 responsive smoke: Deal and Review controls remain usable', async ({ browser }) => {
  let scenario: Scenario | undefined;
  try {
    scenario = await createScenario(browser);
    const { buyer, sellerA } = scenario.actors;
    await json(await sellerA.context.request.post(`/api/orders/${scenario.orderA}/seller-confirm`, { data: {} }), 200);

    await sellerA.page.setViewportSize({ width: 320, height: 700 });
    await openOrders(sellerA);
    const activeCard = dealCard(sellerA, scenario.title, buyer.username);
    await expect(activeCard.getByRole('button', { name: '✔ Угода відбулася' })).toBeVisible();
    await assertNoHorizontalOverflow(sellerA.page);

    for (const viewport of [{ width: 1440, height: 900 }, { width: 1280, height: 800 }, { width: 1024, height: 768 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 320, height: 700 }]) {
      const title = await createCompletedReviewDeal(buyer, sellerA, String(viewport.width));
      await openOrders(buyer, 'completed');
      const completedCard = dealCard(buyer, title, sellerA.username);
      await buyer.page.setViewportSize(viewport);
      await expect(completedCard.getByRole('button', { name: 'Залишити відгук' })).toBeVisible();
      await completedCard.getByRole('button', { name: 'Залишити відгук' }).click();
      await expect(completedCard.getByLabel('Загальна оцінка (1–12)')).toBeVisible();
      await expect(completedCard.getByText(`Відгук про продавця: @${sellerA.username}`)).toBeVisible();
      await expect(completedCard.getByRole('button', { name: 'Скасувати' })).toBeVisible();
      await assertNoHorizontalOverflow(buyer.page);
      await completedCard.getByRole('button', { name: 'Скасувати' }).click();
      await expect(completedCard.getByLabel('Загальна оцінка (1–12)')).toHaveCount(0);
      await submitReview(buyer, completedCard, 12, `Automated ${viewport.width}px review`, true);
      await expect(completedCard.getByText('Ваш відгук збережено.')).toBeVisible();
      await assertNoHorizontalOverflow(buyer.page);
    }
  } finally {
    await cleanupScenario(scenario);
  }
});
