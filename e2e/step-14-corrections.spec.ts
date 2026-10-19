import { expect, test } from '@playwright/test';
import { Client } from 'pg';

const rivne = 'UA56060470010041018';
const lutsk = 'UA07080170010083384';
const categoryCode = 'grains';

test('Step 14 corrections: subscription API, alerts, radius and responsive fields', async ({ browser }) => {
  test.setTimeout(600_000);
  if (!process.env.DATABASE_URL || !new URL(process.env.DATABASE_URL).pathname.includes('step14_qa_')) throw new Error('Run only on isolated Step 14 QA database');
  const seller = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 900 } });
  const buyer = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 900 } });
  const db = new Client({ connectionString: process.env.DATABASE_URL });
  const users: string[] = [];
  const stamp = Date.now().toString(36);
  let connected = false;
  try {
    for (const [index, context] of [seller, buyer].entries()) {
      const username = `step14_fix_${index}_${stamp}`;
      const registered = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${String(Date.now()).slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' } });
      expect(registered.status(), await registered.text()).toBe(201);
      users.push((await registered.json()).user.id);
      expect((await context.request.post('/api/auth/login', { data: { username, password: 'StrongPassword1' } })).status()).toBe(200);
    }
    await db.connect(); connected = true;
    const categoryId = ((await (await buyer.request.get('/api/categories')).json()).categories as { code: string; id: string }[]).find(item => item.code === categoryCode)!.id;
    const list = await seller.request.get('/api/demand-subscriptions');
    expect(list.status(), await list.text()).toBe(200);
    expect((await list.json()).subscriptions).toEqual([]);

    const postal = await seller.request.post('/api/demand-subscriptions', { data: { categoryId, region: 'Рівненська область', deliveryOptions: [{ method: 'POSTAL_DELIVERY', regions: ['Рівненська область'] }] } });
    expect(postal.status(), await postal.text()).toBe(201);
    const postalId = (await postal.json()).subscription.id as string;
    const radius = await seller.request.post('/api/demand-subscriptions', { data: { categoryId, countryCode: 'UA', deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 10, place: { settlementCode: rivne, region: 'Рівненська область', publicPoint: { latitude: 50.62, longitude: 26.25 } } }] } });
    expect(radius.status(), await radius.text()).toBe(201);
    const radiusId = (await radius.json()).subscription.id as string;

    const page = await seller.newPage();
    await page.goto('/settings/demand-subscriptions');
    await expect(page.getByRole('article', { name: /Підписка:/ })).toHaveCount(2);
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Subscription overflow at ${width}`).toBe(true);
    }
    const createRequest = async (title: string, code: string, city: string, latitude: number, longitude: number, method: string) => buyer.request.post('/api/buy-requests', { data: {
      categoryId, title, description: '', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: city, settlementCode: code,
      latitude, longitude, mapLocationMode: 'pin', countryCode: 'UA', deliveryOptions: [method === 'SELF_PICKUP' ? { method, radiusKm: 0 } : { method }], fulfillmentMode: 'single_seller',
    } });
    const postalRequest = await createRequest(`Пошта Рівне ${stamp}`, rivne, 'Рівне', 50.6199, 26.2516, 'POSTAL_DELIVERY');
    expect(postalRequest.status(), await postalRequest.text()).toBe(201);
    const postalRequestId = (await postalRequest.json()).buyRequest.id as string;
    expect((await db.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id=$1 AND buy_request_id=$2', [postalId, postalRequestId])).rows[0].count).toBe(1);
    const localRequest = await createRequest(`Доставка Рівне ${stamp}`, rivne, 'Рівне', 50.6199, 26.2516, 'SELLER_DELIVERY');
    expect(localRequest.status(), await localRequest.text()).toBe(201);
    const localRequestId = (await localRequest.json()).buyRequest.id as string;
    expect((await db.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id=$1 AND buy_request_id=$2', [radiusId, localRequestId])).rows[0].count).toBe(1);

    expect((await createRequest(`Пошта Луцьк ${stamp}`, lutsk, 'Луцьк', 50.747, 25.325, 'POSTAL_DELIVERY')).status()).toBe(201);
    expect((await createRequest(`Доставка Луцьк ${stamp}`, lutsk, 'Луцьк', 50.747, 25.325, 'SELLER_DELIVERY')).status()).toBe(201);
    expect((await createRequest(`Самовивіз ${stamp}`, rivne, 'Рівне', 50.6199, 26.2516, 'SELF_PICKUP')).status()).toBe(201);
    expect((await createRequest(`Чужа точка ${stamp}`, rivne, 'Рівне', 0, 0, 'SELLER_DELIVERY')).status()).toBe(400);
    expect((await db.query('SELECT count(*)::int AS count FROM notifications WHERE user_id=$1 AND demand_subscription_id IN ($2,$3)', [users[0], postalId, radiusId])).rows[0].count).toBe(2);

    await page.goto('/notifications');
    await expect(page.getByText(`Пошта Рівне ${stamp}`).first()).toBeVisible();
    await expect(page.getByText(`Доставка Рівне ${stamp}`).first()).toBeVisible();
    for (const width of [390, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `Notification overflow at ${width}`).toBe(true);
    }
  } finally {
    await Promise.all([seller.close(), buyer.close()]);
    if (users.length) {
      if (!connected) { await db.connect(); connected = true; }
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
    }
    if (connected) await db.end();
  }
});
