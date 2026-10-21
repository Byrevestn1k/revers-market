import { readFile } from 'node:fs/promises';
import { Client } from 'pg';
import { expect, test, type Page } from '@playwright/test';

test.setTimeout(120_000);

async function credentials(section: string) {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error('Local QA account unavailable');
  return { username, password };
}

async function login(page: Page, section: string, destination: string) {
  const { username, password } = await credentials(section);
  await page.goto('/auth/login?return=' + encodeURIComponent(destination));
  await page.locator('input[name="username"]').fill(username);
  await page.locator('input[name="password"]').fill(password);
  await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
  await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/') + '$'), { timeout: 30_000 });
  return username;
}

test('correct accessory recommendation fits product form at 390 and 1440 px', async ({ page }) => {
  await login(page, 'Hybrid', '/my/products/new');
  await page.getByLabel('Назва товару').fill('Чохол для автомобіля Toyota');
  const picker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
  await picker.fill('Чохли, тенти та накидки');
  await page.getByRole('option', { name: /Чохли, тенти та накидки/ }).last().click();
  const recommendation = page.locator('.category-recommendation');
  await expect(recommendation).toContainText('Чохли, тенти та накидки');
  await expect(recommendation).not.toContainText('не відповідає товару');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `overflow at ${width}`).toBe(true);
    const controls = [page.getByLabel('Назва товару'), picker, recommendation, page.getByRole('button', { name: 'Опублікувати товар' })];
    for (const control of controls) {
      const box = await control.boundingBox();
      expect(box && box.x >= -1 && box.x + box.width <= width + 1, `clipped control at ${width}`).toBe(true);
    }
  }
  await page.getByLabel('Назва товару').fill('Насос універсальний Step16');
  await expect(recommendation).toContainText('Категорію не вдалося визначити точно');
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `uncertain notice overflow at ${width}`).toBe(true);
    const box = await recommendation.boundingBox();
    expect(box && box.x >= -1 && box.x + box.width <= width + 1, `uncertain notice clipped at ${width}`).toBe(true);
  }
});

test('Seller Offer can be sent from its own form after entering the labeled price', async ({ browser }) => {
  if (!process.env.DATABASE_URL) throw new Error('Real local PostgreSQL required');
  const buyer = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const seller = await browser.newContext({ viewport: { width: 390, height: 850 } });
  const buyerPage = await buyer.newPage(), sellerPage = await seller.newPage();
  let requestId: string | undefined, offerId: string | undefined, buyerName: string | undefined;
  try {
    buyerName = await login(buyerPage, 'Buyer A', '/my/requests/new');
    const categories = (await (await buyer.request.get('/api/categories')).json()).categories;
    const honey = categories.find((item: { code: string }) => item.code === 'honey_raw')?.id;
    expect(honey).toBeTruthy();
    const created = await buyer.request.post('/api/buy-requests', { data: {
      title: `Куплю мед натуральний Step16 offer ${Date.now()}`, description: 'Потрібен мед у відрах',
      categoryId: honey, quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Київ',
    } });
    expect(created.status(), await created.text()).toBe(201);
    requestId = (await created.json()).buyRequest.id;
    const sellerCredentials = await credentials('Seller A');
    const sellerLogin = await seller.request.post('/api/auth/login', { data: sellerCredentials });
    expect(sellerLogin.status(), await sellerLogin.text()).toBe(200);
    await sellerPage.goto(`/buy-requests/${requestId}`);
    await sellerPage.getByRole('button', { name: 'Запропонувати товар' }).click();
    const form = sellerPage.locator('form.seller-offer-form');
    await expect(form).toBeVisible();
    await form.getByLabel(/Ціна за/).fill('100');
    await expect(form.getByLabel(/Ціна за/)).toHaveValue('100');
    await form.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    await form.getByRole('button', { name: 'Переглянути умови' }).click();
    await expect(form.getByText('Перевірте перед надсиланням')).toBeVisible();
    const sent = sellerPage.waitForResponse(response => new URL(response.url()).pathname === `/api/buy-requests/${requestId}/offers` && response.request().method() === 'POST');
    await form.getByRole('button', { name: 'Надіслати пропозицію' }).click();
    const response = await sent;
    expect(response.status(), await response.text()).toBe(201);
    offerId = (await response.json()).offer.id;
    await expect(form).toHaveCount(0);
  } finally {
    await Promise.allSettled([buyer.close(), seller.close()]);
    if (requestId && buyerName) {
      const db = new Client({ connectionString: process.env.DATABASE_URL });
      await db.connect();
      try {
        if (offerId) await db.query('DELETE FROM offers WHERE id = $1', [offerId]);
        await db.query('DELETE FROM buy_requests WHERE id = $1 AND buyer_id = (SELECT id FROM users WHERE username = $2)', [requestId, buyerName]);
      } finally { await db.end(); }
    }
  }
});
