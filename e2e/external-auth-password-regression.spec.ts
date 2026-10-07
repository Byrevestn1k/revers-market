import { expect, test } from '@playwright/test';

test('existing password account keeps protected pages and internal User ID', async ({ page }) => {
  test.skip(!process.env.QA_USERNAME || !process.env.QA_PASSWORD, 'Local QA credentials are required');
  await page.goto('/auth/login');
  await page.getByLabel('Логін, електронна пошта').fill(process.env.QA_USERNAME!);
  await page.locator('input[name="password"]').fill(process.env.QA_PASSWORD!);
  await page.getByRole('button', { name: /Увійти в акаунт/ }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  const me = await page.request.get('/api/auth/me');
  expect(me.status()).toBe(200);
  const userId = (await me.json()).user.id as string;
  expect(userId).toMatch(/^[0-9a-f-]{36}$/i);

  for (const path of ['/my/products', '/my/requests', '/orders', '/messages', '/notifications', '/settings/profile']) {
    await page.goto(path);
    await expect(page.getByText('Увійдіть, щоб відкрити цю сторінку')).toHaveCount(0);
    expect((await page.request.get('/api/auth/me')).status(), `session lost on ${path}`).toBe(200);
  }
  if (process.env.QA_CONVERSATION_ID) {
    await page.goto(`/messages/${process.env.QA_CONVERSATION_ID}`);
    await expect(page.getByText('Увійдіть, щоб відкрити цю сторінку')).toHaveCount(0);
  }

  await page.request.post('/api/auth/logout');
  expect((await page.request.get('/api/auth/me')).status()).toBe(401);
});
