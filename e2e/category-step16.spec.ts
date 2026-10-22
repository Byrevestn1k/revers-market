import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

test.setTimeout(180_000);
async function account(section: string) {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error('Local QA account unavailable');
  return { username, password };
}
async function login(page: Page, section: string, destination: string) {
  const credentials = await account(section);
  await page.goto('/auth/login?return=' + encodeURIComponent(destination));
  await page.locator('input[name="username"]').fill(credentials.username);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
  await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/') + '$'), { timeout: 30_000 });
}
async function choose(page: Page, search: string, option: RegExp) {
  const picker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
  await picker.fill(search);
  const category = page.getByRole('option', { name: option }).last();
  const selectParent = category.locator('..').getByRole('button', { name: /Вибрати категорію/ });
  if (await selectParent.count()) await selectParent.click();
  else await category.click();
}
async function fits(page: Page, width: number) {
  await page.setViewportSize({ width, height: 900 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`).toBe(true);
  for (const selector of ['input[name="title"]', '.category-picker input[role="combobox"]', '.category-recommendation', '.listing-form-actions button, .deal-actions button']) {
    const control = page.locator(selector).first();
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} clipped at ${width}`).toBe(true);
  }
}

test('safe category flow publishes, warns, allows manual change and accepts a report at 390/1440', async ({ browser }) => {
  if (!process.env.DATABASE_URL) throw new Error('Real local PostgreSQL required');
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await owner.newPage();
  const stamp = Date.now();
  let matsId: string | undefined, wrongId: string | undefined, requestId: string | undefined;
  try {
    await login(page, 'Hybrid', '/my/products/new');
    await page.locator('input[name="title"]').fill(`Килимки автомобіля Toyota Step16 ${stamp}`);
    await choose(page, 'Автомобільні килимки', /Автомобільні килимки/);
    await expect(page.getByRole('combobox', { name: 'Пошук або вибір категорії' })).toHaveValue(/Автомобільні килимки/);
    await fits(page, 1440);
    await fits(page, 390);
    await page.locator('input[name="quantity"]').fill('1');
    await page.locator('input[name="price"]').fill('100');
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    const matsCreated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const matsResponse = await matsCreated;
    expect(matsResponse.status(), await matsResponse.text()).toBe(201);
    matsId = (await matsResponse.json()).product.id;

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/my/products/new');
    await page.locator('input[name="title"]').fill(`Мед натуральний Step16 ${stamp}`);
    await choose(page, 'Легкові автомобілі', /Авто › Легкові автомобілі/);
    await expect(page.locator('.category-recommendation')).toContainText('Можливо, для цього оголошення більше підходить інша категорія.');
    await expect(page.getByRole('button', { name: 'Оскаржити відхилення' })).toHaveCount(0);
    await fits(page, 1440);
    await fits(page, 390);
    await page.locator('input[name="quantity"]').fill('1');
    await page.locator('input[name="price"]').fill('100');
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    const warnedCreated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/products' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const warnedResponse = await warnedCreated;
    expect(warnedResponse.status(), await warnedResponse.text()).toBe(201);
    expect((await warnedResponse.json()).categoryWarning.level).toBe('warn');
    wrongId = (await warnedResponse.json()).product.id;

    const viewer = await browser.newContext({ viewport: { width: 390, height: 850 } });
    try {
      const otherPage = await viewer.newPage();
      await login(otherPage, 'Buyer A', '/products/' + wrongId);
      await otherPage.getByRole('button', { name: 'Повідомити про проблему з оголошенням' }).click();
      const reported = otherPage.waitForResponse(r => new URL(r.url()).pathname === '/api/reports' && r.request().method() === 'POST');
      await otherPage.getByRole('button', { name: 'Надіслати скаргу' }).click();
      expect((await reported).status()).toBe(201);
      await expect(otherPage.getByText('Скаргу збережено для розгляду.')).toBeVisible();
    } finally { await viewer.close(); }

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/my/products/' + wrongId + '/edit');
    await choose(page, 'Мед', /› Мед$/);
    await expect(page.getByRole('combobox', { name: 'Пошук або вибір категорії' })).toHaveValue(/› Мед$/);
    const changed = page.waitForResponse(r => new URL(r.url()).pathname === '/api/products/' + wrongId && r.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Зберегти зміни' }).click();
    expect((await changed).status()).toBe(200);

    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto('/my/requests/new');
    await page.locator('input[name="title"]').fill(`Автомобільний чохол Toyota Step16 ${stamp}`);
    await choose(page, 'Чохли, тенти та накидки', /Чохли, тенти та накидки/);
    await expect(page.getByRole('combobox', { name: 'Пошук або вибір категорії' })).toHaveValue(/Чохли, тенти та накидки/);
    await fits(page, 390);
    await fits(page, 1440);
    await page.locator('input[name="quantity"]').fill('1');
    await page.getByRole('checkbox', { name: 'Можна придбати частинами у різних продавців' }).check();
    await page.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    const createdRequest = page.waitForResponse(r => new URL(r.url()).pathname === '/api/buy-requests' && r.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати запит' }).click();
    const response = await createdRequest;
    expect(response.status(), await response.text()).toBe(201);
    requestId = (await response.json()).buyRequest.id;
    await page.goto('/buy-requests/' + requestId);
    await expect(page.getByRole('heading', { name: /Автомобільний чохол Toyota Step16/ })).toBeVisible();
  } finally {
    await Promise.allSettled([owner.close()]);
    if (matsId || wrongId || requestId) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try {
        if (wrongId) await db.query("DELETE FROM reports WHERE target_type = 'product' AND target_id = $1", [wrongId]);
        if (requestId) await db.query('DELETE FROM buy_requests WHERE id = $1 AND buyer_id = (SELECT id FROM users WHERE username = $2)', [requestId, (await account('Hybrid')).username]);
        for (const id of [matsId, wrongId]) if (id) await db.query('DELETE FROM products WHERE id = $1 AND owner_id = (SELECT id FROM users WHERE username = $2)', [id, (await account('Hybrid')).username]);
      } finally { await db.end(); }
    }
  }
});
