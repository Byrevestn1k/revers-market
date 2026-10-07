import { expect, test } from '@playwright/test';

const viewports = [1440, 1280, 1024, 768, 390, 320];

test('external login, registration and settings fit all required widths', async ({ page }) => {
  test.setTimeout(300_000);
  await page.route('**/api/auth/external/availability', route => route.fulfill({ json: { providers: { google: true, facebook: true, telegram: true } } }));
  await page.route('**/api/categories', route => route.fulfill({ json: { categories: [] } }));
  await page.route('**/api/auth/me', route => route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } }));

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/auth/login', { waitUntil: 'domcontentloaded' });
    for (const provider of ['Google', 'Facebook', 'Telegram']) await expect(page.getByRole('link', { name: `Продовжити з ${provider}` })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `login overflow at ${width}`).toBe(true);
    if (width === 320) await page.locator('.auth-card').screenshot({ path: 'test-results/step6-login-320.png' });
    await page.goto('/auth/register', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('link', { name: 'Продовжити з Telegram' })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `register overflow at ${width}`).toBe(true);
    if (width === 320) await page.locator('.auth-card').screenshot({ path: 'test-results/step6-register-320.png' });
  }

  await page.goto('/auth/login?return=https%3A%2F%2Fevil.example&externalAuth=cancelled');
  await expect(page.getByRole('alert')).toContainText('Вхід скасовано');
  const href = await page.getByRole('link', { name: 'Продовжити з Google' }).getAttribute('href');
  expect(href).toContain('return=%2Fdashboard');
  expect(href).not.toContain('evil.example');

  await page.route('**/api/auth/external/availability', route => route.fulfill({ json: { providers: { google: false, facebook: false, telegram: false } } }));
  await page.goto('/auth/login');
  await expect(page.getByRole('link', { name: 'Продовжити з Google' })).toHaveCount(0);
});

test('social signup with no provider email completes the browser flow', async ({ page }) => {
  const user = { id: 'new-social-user', username: 'new_social_user', countryCode: 'UA', phone: '+380501234567', email: 'new@example.invalid', emailVerified: false };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } });
    if (path === '/api/auth/external/pending') return route.fulfill({ json: { provider: 'telegram', email: null, displayName: 'Telegram user', originPage: 'register', emailConflict: false } });
    if (path === '/api/auth/external/finish') return route.fulfill({ status: 201, json: { user, emailVerificationSent: false, returnPath: '/dashboard' } });
    if (path === '/api/categories') return route.fulfill({ json: { categories: [] } });
    if (path === '/api/conversations') return route.fulfill({ json: { conversations: [] } });
    if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], unreadCounts: { total: 0 } } });
    if (path.startsWith('/api/products')) return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } });
    return route.fulfill({ status: 404, json: {} });
  });
  await page.setViewportSize({ width: 320, height: 700 });
  await page.goto('/auth/external/finish');
  await expect(page.getByRole('heading', { name: 'Завершіть реєстрацію' })).toBeVisible();
  await expect(page.getByLabel('Електронна пошта')).toHaveValue('');
  await page.getByLabel('Логін').fill('new_social_user');
  await page.getByLabel('Електронна пошта').fill('new@example.invalid');
  await page.getByLabel('Номер телефону').fill('501234567');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Створити акаунт' }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
});

test('unknown login asks existing or new account without guessing identity', async ({ page }) => {
  test.setTimeout(180_000);
  let emailConflict = false;
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/external/pending') return route.fulfill({ json: { provider: 'telegram', email: null, displayName: 'Telegram user', originPage: 'login', emailConflict } });
    if (path === '/api/auth/external/availability') return route.fulfill({ json: { providers: { google: true, facebook: true, telegram: true } } });
    if (path === '/api/auth/me') return route.fulfill({ status: 401, json: { error: 'AUTH_REQUIRED' } });
    if (path === '/api/categories') return route.fulfill({ json: { categories: [] } });
    return route.fulfill({ status: 404, json: {} });
  });
  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/auth/external/finish', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Оберіть свій профіль' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'У мене вже є акаунт' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Створити новий акаунт' })).toBeVisible();
    await expect(page.getByLabel('Електронна пошта')).toHaveCount(0);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `choice overflow at ${width}`).toBe(true);
    if (width === 320) await page.locator('.auth-card').screenshot({ path: 'test-results/step6-account-choice-320.png' });
  }
  await page.getByRole('link', { name: 'У мене вже є акаунт' }).click();
  await expect(page.getByRole('heading', { name: 'Увійдіть в існуючий акаунт' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Продовжити з Telegram' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Продовжити з Google' })).toBeVisible();
  emailConflict = true;
  await page.goto('/auth/external/finish');
  await expect(page.getByRole('button', { name: 'Створити новий акаунт' })).toHaveCount(0);
  await expect(page.getByText('Ця електронна адреса вже використовується.')).toBeVisible();
});

test('linked login methods, unlink dialog and last-method error fit all required widths', async ({ page }) => {
  test.setTimeout(300_000);
  const user = { id: 'qa-user', username: 'qa_user', countryCode: 'UA', phone: '+380501234567', email: 'qa@example.invalid', emailVerified: false };
  const profile = { ...user, phoneVerified: false, nickname: null, avatarUrl: null, bio: null, recoveryEmail: null,
    location: null, exactAddress: null, settlement: null, addressSettlement: null, addressCoordinates: null,
    mapLocation: { mode: 'approximate', latitude: null, longitude: null, consent: false },
    privacy: { phoneVisibility: 'private', phoneDisclosureConsent: false },
    statistics: { listingsCount: 0, completedDealsCount: 0, responseRate: null }, ratingSummary: { average: null, count: 0 } };
  await page.route('**/api/**', route => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/auth/me') return route.fulfill({ json: { user } });
    if (path === '/api/profile/me') return route.fulfill({ json: { profile } });
    if (path === '/api/auth/external/methods') return route.fulfill({ json: { password: false, providers: { google: true, facebook: false, telegram: true }, identities: [{ provider: 'telegram', email: null, username: 'tester', displayName: 'Tester' }] } });
    if (path === '/api/auth/external/methods/telegram') return route.fulfill({ status: 409, json: { error: 'LAST_LOGIN_METHOD', message: 'Спочатку додайте інший спосіб входу.' } });
    if (path === '/api/categories') return route.fulfill({ json: { categories: [] } });
    if (path === '/api/conversations') return route.fulfill({ json: { conversations: [] } });
    if (path === '/api/notifications') return route.fulfill({ json: { notifications: [], unreadCounts: { total: 0 } } });
    if (path.startsWith('/api/products')) return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } });
    return route.fulfill({ status: 404, json: {} });
  });

  for (const width of viewports) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/settings/profile', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Способи входу' })).toBeVisible();
    await expect(page.getByText('Не встановлено', { exact: true })).toBeVisible();
    await expect(page.getByText('Пароль не встановлено. Для входу використовуйте підключений спосіб.')).toBeVisible();
    await expect(page.getByRole('link', { name: 'Підключити' }).first()).toHaveAttribute('href', /intent=link/);
    await page.getByRole('button', { name: 'Від’єднати' }).first().click();
    await expect(page.getByRole('dialog')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `settings/dialog overflow at ${width}`).toBe(true);
    if (width === 320) await page.getByRole('dialog').screenshot({ path: 'test-results/step6-unlink-dialog-320.png' });
    await page.getByRole('dialog').getByRole('button', { name: 'Від’єднати' }).click();
    await expect(page.getByRole('alert')).toContainText('Спочатку додайте інший спосіб входу.');
    if (width === 320) await page.locator('.login-methods').screenshot({ path: 'test-results/step6-login-methods-320.png' });
  }
});
