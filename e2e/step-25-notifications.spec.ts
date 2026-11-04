import { expect, test } from '@playwright/test';
import { Client } from 'pg';
import { mkdir } from 'node:fs/promises';

test.setTimeout(180_000);
const databaseUrl = process.env.DATABASE_URL ?? '';
if (databaseUrl !== 'postgresql://step25_test:step25_test@127.0.0.1:55432/step25_test') throw new Error('Step 25 requires its isolated database');

for (const width of [390, 1280, 1440, 1024, 768, 320]) {
  test(`real notification center at ${width}px`, async ({ page, request }) => {
    const suffix = `${Date.now()}${width}`;
    const username = `step25_${suffix}`;
    const password = 'StrongPassword1';
    const registered = await request.post('http://127.0.0.1:33025/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+38050${suffix.slice(-7)}`, password, passwordConfirmation: password } });
    expect(registered.status(), await registered.text()).toBe(201);
    const userId = (await registered.json()).user.id;
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      await db.query(`INSERT INTO notifications (user_id, type, title, body, context)
        SELECT $1, 'system', 'Подія покупки ' || n, 'Довгий текст для перевірки відображення сповіщення', 'buying' FROM generate_series(1, 22) n`, [userId]);
      await db.query("INSERT INTO notifications (user_id, type, title, body, context) VALUES ($1, 'system', 'Подія продажу', 'Перевірка продажу', 'selling'), ($1, 'system', 'Стара подія', 'Перевірка історії', NULL)", [userId]);
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/auth/login?return=%2Fnotifications');
      await page.locator('input[name="username"]').fill(username);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
      await expect(page).toHaveURL(/\/notifications$/);
      await page.getByRole('tab', { name: /Я покупець/ }).click();
      await expect(page.getByRole('tab', { name: /Я покупець/ })).toContainText('22');
      await expect(page.locator('.notification-row')).toHaveCount(20);
      await page.getByRole('button', { name: 'Показати ще' }).click();
      await expect(page.locator('.notification-row')).toHaveCount(22);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      for (const button of await page.locator('.notification-context-tabs button:visible, .notification-row button:visible').all()) {
        const box = await button.boundingBox();
        expect(box && box.x >= 0 && box.x + box.width <= width + 1).toBeTruthy();
      }
      await mkdir('docs/evidence/step-25', { recursive: true });
      await page.screenshot({ path: `docs/evidence/step-25/notifications-${width}.png`, fullPage: true });
      await page.locator('.notification-row').first().getByRole('button', { name: 'Позначити прочитаним' }).click();
      await expect(page.getByRole('tab', { name: /Я покупець/ })).toContainText('21');
      await page.getByRole('button', { name: 'Непрочитані', exact: true }).click();
      await expect(page.locator('.notification-row')).toHaveCount(20);
      await page.getByRole('button', { name: 'Позначити всі прочитаними' }).click();
      await expect(page.getByRole('tab', { name: /Я покупець/ })).toContainText('0');
      await page.getByRole('tab', { name: /Я продавець/ }).click();
      await expect(page.getByText('Подія продажу')).toBeVisible();
      await page.getByRole('tab', { name: /Інші події/ }).click();
      await expect(page.getByText('Стара подія')).toBeVisible();
      const counts = await db.query('SELECT context, count(*)::int AS count FROM notifications WHERE user_id=$1 AND read_at IS NULL GROUP BY context', [userId]);
      expect(counts.rows).toEqual(expect.arrayContaining([{ context: 'selling', count: 1 }, { context: null, count: 1 }]));
      await page.getByRole('button', { name: 'Налаштування сповіщень' }).click();
      await expect(page).toHaveURL(/\/settings\/demand-subscriptions$/);
    } finally {
      await db.query('DELETE FROM users WHERE id=$1', [userId]);
      await db.end();
    }
  });
}

for (const width of [390, 1280]) {
  test(`offer notifications open the correct offer at ${width}px`, async ({ browser, request }) => {
    const suffix = `${Date.now()}${width}`;
    const password = 'StrongPassword1';
    const buyerName = `s25b_${suffix}`;
    const sellerName = `s25s_${suffix}`;
    const sellerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width, height: 900 } });
    const buyerContext = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width, height: 900 } });
    const buyerApi = buyerContext.request;
    const sellerApi = sellerContext.request;
    const users: string[] = [];
    const db = new Client({ connectionString: databaseUrl });
    await db.connect();
    try {
      for (const [api, username, prefix] of [[buyerApi, buyerName, '50'], [sellerApi, sellerName, '67']] as const) {
        const response = await api.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${prefix}${suffix.slice(-7)}`, password, passwordConfirmation: password } });
        expect(response.status(), await response.text()).toBe(201);
        users.push((await response.json()).user.id);
      }
      const categories = (await (await request.get('http://127.0.0.1:33025/api/categories')).json()).categories;
      const category = categories.find((item: { code: string }) => item.code === 'grains');
      const created = await buyerApi.post('/api/buy-requests', { data: { categoryId: category.id, title: `Запит Step 25 ${width}`, description: '', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 1, maxPrice: 20, delivery: 'no', geoArea: 'Київ', fulfillmentMode: 'multiple_sellers' } });
      expect(created.status(), await created.text()).toBe(201);
      const requestId = (await created.json()).buyRequest.id;
      const offered = await sellerApi.post(`/api/buy-requests/${requestId}/offers`, { data: { quantity: 10, unit: 'kg', price: 10, currency: 'UAH', delivery: 'Самовивіз' } });
      expect(offered.status(), await offered.text()).toBe(201);
      const offerId = (await offered.json()).offer.id;
      const buyer = await buyerContext.newPage();
      await buyer.goto('/notifications');
      await buyer.getByRole('tab', { name: /Я покупець/ }).click();
      const buyerEvent = buyer.locator('.notification-row').filter({ hasText: 'Нова пропозиція' });
      await expect(buyerEvent).toBeVisible();
      await buyerEvent.getByRole('button', { name: 'Переглянути' }).click();
      await expect(buyer).toHaveURL(new RegExp(`/my/requests\\?request=${requestId}&offer=${offerId}`));
      await expect(buyer.locator('.deal-offer-focused')).toBeVisible();
      expect((await buyerApi.post(`/api/offers/${offerId}/reject`)).status()).toBe(204);
      const seller = await sellerContext.newPage();
      await seller.goto('/notifications');
      await seller.getByRole('tab', { name: /Я продавець/ }).click();
      const sellerEvent = seller.locator('.notification-row').filter({ hasText: 'Пропозицію відхилено' });
      await expect(sellerEvent).toBeVisible();
      await sellerEvent.getByRole('button', { name: 'Переглянути' }).click();
      await expect(seller).toHaveURL(new RegExp(`/requests\\?offer=${offerId}`));
      await expect(seller.locator('.deal-offer-focused')).toBeVisible();
    } finally {
      await buyerContext.close();
      await sellerContext.close();
      await db.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      await db.end();
    }
  });
}
