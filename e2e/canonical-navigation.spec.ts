import { expect, test, type Browser, type BrowserContext } from '@playwright/test';
import { Client } from 'pg';

const password = 'StrongPassword1';

type Actor = { context: BrowserContext; id: string; username: string };

const register = async (browser: Browser, role: string, stamp: string): Promise<Actor> => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const username = `nav_${role}_${stamp}`;
  const response = await context.request.post('/api/auth/register', {
    data: {
      username,
      email: `${username}@example.com`,
      countryCode: 'UA',
      phone: `+38067${String(Date.now()).slice(-6)}${role === 'owner' ? '1' : '2'}`,
      password,
      passwordConfirmation: password,
    },
  });
  expect(response.status()).toBe(201);
  const body = await response.json() as { user: { id: string } };
  return { context, id: body.user.id, username };
};

const cleanup = async (actors: Actor[]) => {
  await Promise.allSettled(actors.map(actor => actor.context.close()));
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  try {
    const ids = actors.map(actor => actor.id);
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

test('keeps a protected conversation deep link after login', async ({ browser }) => {
  const stamp = Date.now().toString(36);
  const actors: Actor[] = [];
  try {
    const owner = await register(browser, 'owner', stamp); actors.push(owner);
    const visitor = await register(browser, 'visitor', stamp); actors.push(visitor);
    const categories = await owner.context.request.get('/api/categories');
    const categoryId = (await categories.json() as { categories: Array<{ id: string }> }).categories[0].id;
    const createdRequest = await owner.context.request.post('/api/buy-requests', {
      data: { categoryId, title: `Canonical chat ${stamp}`, description: '', delivery: 'no', exactPrice: 1, quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', fulfillmentMode: 'single_seller' },
    });
    expect(createdRequest.status()).toBe(201);
    const requestId = (await createdRequest.json() as { buyRequest: { id: string } }).buyRequest.id;
    const conversationResponse = await visitor.context.request.post(`/api/buy-requests/${requestId}/conversation`, { data: {} });
    expect(conversationResponse.status()).toBe(201);
    const conversationId = (await conversationResponse.json() as { conversation: { id: string } }).conversation.id;

    const anonymous = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
    const page = await anonymous.newPage();
    await page.goto(`/messages/${conversationId}`);
    await expect(page.getByRole('heading', { name: 'Увійдіть, щоб відкрити цю сторінку' })).toBeVisible();
    await page.getByRole('button', { name: 'Увійти або зареєструватися' }).click();
    await page.getByRole('button', { name: 'Увійти', exact: true }).click();
    await page.getByLabel('Логін, електронна пошта').fill(visitor.username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
    await expect(page).toHaveURL(new RegExp(`/messages/${conversationId}$`));
    await expect(page.getByRole('heading', { name: `Canonical chat ${stamp}` })).toBeVisible();
    await anonymous.close();
  } finally {
    await cleanup(actors);
  }
});

test('renders public products and map destinations after direct load and refresh', async ({ browser }) => {
  const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
  const page = await context.newPage();
  try {
    await page.goto('/products');
    await expect(page.getByRole('heading', { name: 'Знайти товари' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Знайти товари' })).toBeVisible();

    await page.goto('/map');
    await expect(page.getByRole('heading', { name: 'Мапа поруч' })).toBeVisible();
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Мапа поруч' })).toBeVisible();
  } finally {
    await context.close();
  }
});
