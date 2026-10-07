import { expect, test } from '@playwright/test';
import { Client } from 'pg';

test('Google signup and login, Facebook and Telegram linking, login and unlink use one Marketplace user', async ({ page }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const username = `e2e_ext_${suffix}`;
  const codes = { google: `e2e-${suffix}-google`, facebook: `e2e-${suffix}-facebook`, telegram: `e2e-${suffix}-telegram` };
  const completeProvider = async (provider: keyof typeof codes, link: ReturnType<typeof page.getByRole>) => {
    const href = await link.getAttribute('href');
    expect(href).toBeTruthy();
    const response = await page.request.get(href!, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const authorization = new URL(response.headers().location);
    expect(authorization.searchParams.get('response_type')).toBe('code');
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', codes[provider]);
    await page.goto(callback.toString(), { waitUntil: 'domcontentloaded' });
  };
  const login = async (provider: 'google' | 'facebook' | 'telegram', returnPath = '/dashboard') => {
    await page.goto(`/auth/login?return=${encodeURIComponent(returnPath)}`, { waitUntil: 'domcontentloaded' });
    await completeProvider(provider, page.getByRole('link', { name: `Продовжити з ${provider[0].toUpperCase()}${provider.slice(1)}` }));
    await expect(page).toHaveURL(new RegExp(`${returnPath.replace('/', '\\/')}$`));
    const response = await page.request.get('/api/auth/me');
    expect(response.status()).toBe(200);
    return ((await response.json()) as { user: { id: string } }).user.id;
  };
  const link = async (provider: 'facebook' | 'telegram') => {
    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    const row = page.locator('.login-method-row').filter({ hasText: provider === 'facebook' ? 'Facebook' : 'Telegram' });
    await completeProvider(provider, row.getByRole('link', { name: 'Підключити' }));
    await expect(page).toHaveURL(/\/settings\/profile/);
    await expect(row.getByRole('button', { name: 'Від’єднати' })).toBeVisible();
  };

  try {
    await page.goto('/auth/register', { waitUntil: 'domcontentloaded' });
    await completeProvider('google', page.getByRole('link', { name: 'Продовжити з Google' }));
    await expect(page).toHaveURL(/\/auth\/external\/finish$/);
    await page.getByLabel('Логін').fill(username);
    await page.getByLabel('Номер телефону').fill('501234567');
    await page.getByRole('button', { name: 'Створити акаунт' }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    const me = await page.request.get('/api/auth/me');
    expect(me.status()).toBe(200);
    const userId = ((await me.json()) as { user: { id: string } }).user.id;
    await link('facebook');
    await link('telegram');
    for (const provider of ['google', 'facebook', 'telegram'] as const) {
      await page.request.post('/api/auth/logout');
      expect(await login(provider, provider === 'google' ? '/messages' : '/dashboard')).toBe(userId);
    }
    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    for (const provider of ['facebook', 'telegram'] as const) {
      const row = page.locator('.login-method-row').filter({ hasText: provider === 'facebook' ? 'Facebook' : 'Telegram' });
      await row.getByRole('button', { name: 'Від’єднати' }).click();
      await page.getByRole('dialog').getByRole('button', { name: 'Від’єднати' }).click();
      await expect(row.getByRole('link', { name: 'Підключити' })).toBeVisible();
    }
    const google = page.locator('.login-method-row').filter({ hasText: 'Google' });
    await google.getByRole('button', { name: 'Від’єднати' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Від’єднати' }).click();
    await expect(page.getByRole('alert')).toContainText('Спочатку додайте інший спосіб входу.');
  } finally {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try { await client.query('DELETE FROM users WHERE username_normalized = $1', [username]); }
    finally { await client.end(); }
  }
});

for (const provider of ['facebook', 'telegram'] as const) {
  test(`${provider} direct signup, login, cancellation and failure`, async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = Date.now().toString(36);
    const username = `e2e_${provider.slice(0, 2)}_${suffix}`;
    const code = `e2e-${suffix}-${provider}-direct`;
    const start = async () => {
      await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
      const link = page.getByRole('link', { name: `Продовжити з ${provider === 'facebook' ? 'Facebook' : 'Telegram'}` });
      const href = await link.getAttribute('href');
      expect(href).toBeTruthy();
      const response = await page.request.get(href!, { maxRedirects: 0 });
      expect(response.status()).toBe(302);
      const authorization = new URL(response.headers().location);
      const callback = new URL(authorization.searchParams.get('redirect_uri')!);
      callback.searchParams.set('state', authorization.searchParams.get('state')!);
      return callback;
    };
    try {
      const signupCallback = await start();
      signupCallback.searchParams.set('code', code);
      await page.goto(signupCallback.toString(), { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('heading', { name: 'Оберіть свій профіль' })).toBeVisible();
      expect((await page.request.get('/api/auth/me')).status()).toBe(401);
      await page.getByRole('button', { name: 'Створити новий акаунт' }).click();
      await expect(page.getByRole('heading', { name: 'Завершіть реєстрацію' })).toBeVisible();
      if (provider === 'telegram') await expect(page.getByLabel('Електронна пошта')).toHaveValue('');
      await page.getByLabel('Логін').fill(username);
      await page.getByLabel('Електронна пошта').fill(`${username}@example.invalid`);
      await page.getByLabel('Номер телефону').fill(`50${String(Date.now()).slice(-7)}`);
      await page.getByRole('button', { name: 'Створити акаунт' }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
      const first = await page.request.get('/api/auth/me');
      expect(first.status()).toBe(200);
      const userId = ((await first.json()) as { user: { id: string } }).user.id;
      await page.request.post('/api/auth/logout');

      const loginCallback = await start();
      loginCallback.searchParams.set('code', code);
      await page.goto(loginCallback.toString(), { waitUntil: 'domcontentloaded' });
      await expect(page).toHaveURL(/\/dashboard$/);
      const second = await page.request.get('/api/auth/me');
      expect(second.status()).toBe(200);
      expect(((await second.json()) as { user: { id: string } }).user.id).toBe(userId);
      await page.request.post('/api/auth/logout');

      const cancelled = await start();
      cancelled.searchParams.set('error', 'access_denied');
      await page.goto(cancelled.toString(), { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('alert')).toContainText('Вхід скасовано.');

      const failed = await start();
      await page.goto(failed.toString(), { waitUntil: 'domcontentloaded' });
      await expect(page.getByRole('alert')).toContainText('Не вдалося увійти.');
    } finally {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try { await client.query('DELETE FROM users WHERE username_normalized = $1', [username]); }
      finally { await client.end(); }
    }
  });
}

test('unknown Telegram login links to a password account only after explicit login', async ({ page }) => {
  test.setTimeout(300_000);
  const suffix = Date.now().toString(36);
  const username = `e2e_proof_${suffix}`;
  const password = 'StrongPassword123!';
  const code = `e2e-${suffix}-telegram-proof`;
  const completeTelegram = async () => {
    const href = await page.getByRole('link', { name: 'Продовжити з Telegram' }).getAttribute('href');
    expect(href).toBeTruthy();
    const response = await page.request.get(href!, { maxRedirects: 0 });
    expect(response.status()).toBe(302);
    const authorization = new URL(response.headers().location);
    const callback = new URL(authorization.searchParams.get('redirect_uri')!);
    callback.searchParams.set('state', authorization.searchParams.get('state')!);
    callback.searchParams.set('code', code);
    await page.goto(callback.toString(), { waitUntil: 'domcontentloaded' });
  };
  try {
    const registered = await page.request.post('/api/auth/register', { data: {
      username, email: `${username}@example.invalid`, countryCode: 'UA', phone: `+38050${String(Date.now()).slice(-7)}`,
      password, passwordConfirmation: password,
    } });
    expect(registered.status()).toBe(201);
    const userId = ((await registered.json()) as { user: { id: string } }).user.id;
    await page.request.post('/api/auth/logout');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await completeTelegram();
    await expect(page.getByRole('heading', { name: 'Оберіть свій профіль' })).toBeVisible();
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await page.getByRole('link', { name: 'У мене вже є акаунт' }).click();
    await expect(page.getByRole('heading', { name: 'Увійдіть в існуючий акаунт' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Продовжити з Telegram' })).toHaveCount(0);
    await page.getByLabel('Логін, електронна пошта').fill(username);
    await page.locator('input[name="password"]').fill(password);
    await page.getByRole('button', { name: /Увійти в акаунт/ }).click();
    await expect(page).toHaveURL(/\/auth\/external\/finish\?existing=1$/, { timeout: 60_000 });
    await expect(page.getByRole('heading', { name: 'Підключіть спосіб входу' })).toBeVisible();
    await page.getByRole('button', { name: 'Підключити Telegram' }).click();
    await expect(page).toHaveURL(/\/settings\/profile/);
    await expect(page.locator('.login-method-row').filter({ hasText: 'Telegram' }).getByRole('button', { name: 'Від’єднати' })).toBeVisible();
    await page.request.post('/api/auth/logout');
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    await completeTelegram();
    expect(((await (await page.request.get('/api/auth/me')).json()) as { user: { id: string } }).user.id).toBe(userId);
  } finally {
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    try { await client.query('DELETE FROM users WHERE username_normalized = $1', [username]); }
    finally { await client.end(); }
  }
});
