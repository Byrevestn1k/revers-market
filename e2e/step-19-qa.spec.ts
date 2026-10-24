import { expect, test, type Page } from '@playwright/test';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { Client } from 'pg';

const accounts = existsSync('docs/TEST_ACCOUNTS.local.md') ? readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8').replace(/\r\n/g, '\n') : '';
test.skip(!accounts || !process.env.DATABASE_URL, 'Local QA accounts and database are required.');
const credentials = (section: string) => {
  const block = accounts.split(`## ${section}\n`)[1]?.split('\n## ')[0] ?? '';
  return { username: block.match(/Username: (.+)/)?.[1].trim(), password: block.match(/Password: (.+)/)?.[1].trim() };
};
const screenshotDir = 'docs/step-19-qa';
mkdirSync(screenshotDir, { recursive: true });

test('Step 19 real Chromium UX and persistence', async ({ browser }) => {
  test.setTimeout(480_000);
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const viewer = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const productIds: string[] = [];
  const requestIds: string[] = [];
  const errors: string[] = [];
  const stamp = Date.now().toString(36);
  const productTitle = `Step 19 товар ${stamp}`;
  const requestTitle = `Step 19 запит ${stamp}`;
  const widths = [1440, 768, 390, 320];
  const checkWidth = async (page: Page, width: number, name: string) => {
    await page.setViewportSize({ width, height: 900 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), { message: `${name}: overflow at ${width}px` }).toBe(true);
    await page.screenshot({ path: `${screenshotDir}/${name}-${width}.png`, fullPage: true });
  };
  try {
    expect((await owner.request.post('/api/auth/login', { data: credentials('Hybrid') })).status()).toBe(200);
    expect((await viewer.request.post('/api/auth/login', { data: credentials('Buyer A') })).status()).toBe(200);
    const ownerPage = await owner.newPage();
    ownerPage.setDefaultTimeout(15_000);
    ownerPage.on('pageerror', error => errors.push(error.message));
    const categories = (await (await owner.request.get('/api/categories')).json()).categories as { id: string; code: string; name: string }[];
    const category = categories.find(item => item.code === 'grains')!;
    const chooseCategory = async () => {
      const field = ownerPage.getByRole('combobox', { name: 'Пошук або вибір категорії' });
      await field.fill(category.name);
      await ownerPage.getByRole('option', { name: new RegExp(category.name) }).first().click();
    };

    await ownerPage.goto('/my/products/new', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(ownerPage.getByText(/Місце: .*Рівне/)).toBeVisible();
    const productPlace = ownerPage.locator('.listing-location-note[role="status"] strong').first();
    const inheritedProductPlace = await productPlace.textContent();
    await ownerPage.getByRole('combobox', { name: 'Публічна точка цього оголошення' }).selectOption('pin');
    await ownerPage.locator('.profile-point-picker').click({ position: { x: 180, y: 140 } });
    await expect.poll(() => productPlace.textContent()).not.toBe(inheritedProductPlace);
    await ownerPage.screenshot({ path: `${screenshotDir}/product-pin-1440.png`, fullPage: true });
    await ownerPage.getByRole('combobox', { name: 'Публічна точка цього оголошення' }).selectOption('profile');
    await expect(productPlace).toContainText('Рівне');
    await expect(ownerPage.getByText('Покупець самостійно забирає товар у вас.')).toBeVisible();
    await expect(ownerPage.getByText('Ви доставляєте товар покупцеві в межах доступної вам території.')).toBeVisible();
    await expect(ownerPage.getByText('Ви відправляєте товар покупцеві через поштового оператора.')).toBeVisible();
    await ownerPage.getByLabel('Назва товару').fill(productTitle);
    await chooseCategory();
    await ownerPage.getByLabel('Кількість').fill('10');
    await ownerPage.getByLabel('Ціна за одиницю').fill('100');
    await ownerPage.getByRole('checkbox', { name: 'Самовивіз' }).check();
    await ownerPage.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    for (const method of ['Самовивіз', 'Доставка продавцем', 'Поштова доставка']) {
      await expect(ownerPage.getByRole('checkbox', { name: method })).toBeChecked();
      await expect(ownerPage.getByRole('checkbox', { name: method })).toBeDisabled();
    }
    await ownerPage.getByRole('checkbox', { name: 'Можна домовитися' }).uncheck();
    await expect(ownerPage.getByRole('checkbox', { name: 'Самовивіз' })).toBeChecked();
    await expect(ownerPage.getByRole('checkbox', { name: 'Поштова доставка' })).not.toBeChecked();
    await ownerPage.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    for (const width of widths) await checkWidth(ownerPage, width, 'product-form-flexible');
    await ownerPage.setViewportSize({ width: 1440, height: 900 });
    const productPost = ownerPage.waitForRequest(request => request.url().endsWith('/api/products') && request.method() === 'POST');
    await ownerPage.getByRole('button', { name: 'Опублікувати товар' }).click();
    expect((await productPost).postDataJSON().deliveryOptions).toEqual([{ method: 'FLEXIBLE' }]);
    await expect(ownerPage).toHaveURL(/\/my\/products$/);
    const products = (await (await owner.request.get('/api/products', { params: { mine: 'true' } })).json()).products;
    const product = products.find((item: { title: string }) => item.title === productTitle);
    expect(product).toBeTruthy();
    productIds.push(product.id);
    expect(product.deliveryOptions).toEqual([{ method: 'FLEXIBLE' }]);
    await ownerPage.goto(`/products/${product.id}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await ownerPage.getByRole('button', { name: 'Редагувати товар' }).click();
    await expect(ownerPage.getByRole('checkbox', { name: 'Можна домовитися' })).toBeChecked();
    await expect(ownerPage.getByRole('checkbox', { name: 'Самовивіз' })).toBeDisabled();
    await expect(ownerPage.getByText(/Місце: .*Рівне/)).toBeVisible();

    await ownerPage.goto('/my/requests/new', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await expect(ownerPage.getByText(/Місце: .*Рівне/)).toBeVisible();
    await expect(ownerPage.getByText('Ви самостійно забираєте товар у продавця.')).toBeVisible();
    await expect(ownerPage.getByText('Продавець відправить товар через поштового оператора.')).toBeVisible();
    await ownerPage.getByRole('checkbox', { name: 'Доставка продавцем' }).check();
    await expect(ownerPage.getByText(/Місце доставки: .*Рівне/)).toBeVisible();
    await ownerPage.getByRole('combobox', { name: 'Публічна точка цього оголошення' }).selectOption('pin');
    await ownerPage.locator('.profile-point-picker').click({ position: { x: 180, y: 140 } });
    await expect(ownerPage.getByText(/Місце доставки:/)).toBeVisible();
    await expect.poll(async () => ownerPage.locator('.delivery-destination').textContent()).toContain(await ownerPage.locator('.listing-location-note[role="status"] strong').first().textContent().then(text => (text ?? '').replace('Місце: ', '')));
    await ownerPage.screenshot({ path: `${screenshotDir}/request-pin-destination-1440.png`, fullPage: true });
    await ownerPage.getByRole('combobox', { name: 'Публічна точка цього оголошення' }).selectOption('profile');
    await expect(ownerPage.getByText(/Місце доставки: .*Рівне/)).toBeVisible();
    await ownerPage.getByLabel('Назва товару').fill(requestTitle);
    await chooseCategory();
    await ownerPage.getByLabel('Кількість').fill('3');
    await ownerPage.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    for (const method of ['Самовивіз', 'Доставка продавцем', 'Поштова доставка']) {
      await expect(ownerPage.getByRole('checkbox', { name: method })).toBeChecked();
      await expect(ownerPage.getByRole('checkbox', { name: method })).toBeDisabled();
    }
    await ownerPage.getByRole('checkbox', { name: 'Можна домовитися' }).uncheck();
    await expect(ownerPage.getByRole('checkbox', { name: 'Доставка продавцем' })).toBeChecked();
    await ownerPage.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    for (const width of widths) await checkWidth(ownerPage, width, 'request-form-flexible');
    await ownerPage.setViewportSize({ width: 1440, height: 900 });
    const requestPost = ownerPage.waitForResponse(response => response.url().endsWith('/api/buy-requests') && response.request().method() === 'POST');
    await ownerPage.getByRole('button', { name: 'Опублікувати запит' }).click();
    const requestResponse = await requestPost;
    expect(requestResponse.request().postDataJSON().deliveryOptions).toEqual([{ method: 'FLEXIBLE' }]);
    expect(requestResponse.status()).toBe(201);
    const buyRequest = (await requestResponse.json()).buyRequest;
    expect(buyRequest.title).toBe(requestTitle);
    requestIds.push(buyRequest.id);
    expect(buyRequest.deliveryOptions).toEqual([{ method: 'FLEXIBLE' }]);
    await ownerPage.goto('/my/requests', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await ownerPage.locator('.buy-request-card').filter({ hasText: requestTitle }).getByRole('button', { name: 'Редагувати' }).click();
    const dialog = ownerPage.getByRole('dialog', { name: 'Редагувати запит' });
    await expect(dialog.getByRole('checkbox', { name: 'Можна домовитися' })).toBeChecked();
    await expect(dialog.getByRole('checkbox', { name: 'Самовивіз' })).toBeDisabled();
    await expect(dialog.getByText(/Місце: .*Рівне/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Скасувати' }).click();

    const viewerPage = await viewer.newPage();
    viewerPage.setDefaultTimeout(15_000);
    viewerPage.on('pageerror', error => errors.push(error.message));
    await viewerPage.goto(`/profiles/${credentials('Hybrid').username}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
    const productCard = viewerPage.locator('.product-card').filter({ hasText: productTitle });
    const requestCard = viewerPage.locator('.buy-request-card').filter({ hasText: requestTitle });
    await expect(productCard).toBeVisible();
    const requestsTab = viewerPage.getByRole('tab', { name: /Запити на покупку/ });
    const productsTab = viewerPage.getByRole('tab', { name: /Усі товари/ });
    for (const width of widths) {
      await productsTab.click();
      await checkWidth(viewerPage, width, 'favorite-product');
      await requestsTab.click();
      await expect(requestCard).toBeVisible();
      await checkWidth(viewerPage, width, 'favorite-request');
      for (const [card, image] of [[requestCard, requestCard.locator('.buy-request-card-image')]] as const) {
        const button = card.getByRole('button', { name: 'Додати в обране' });
        const imageBox = await image.boundingBox();
        const buttonBox = await button.boundingBox();
        expect(imageBox && buttonBox).toBeTruthy();
        expect(buttonBox!.x).toBeGreaterThanOrEqual(imageBox!.x);
        expect(buttonBox!.y).toBeGreaterThanOrEqual(imageBox!.y);
        expect(buttonBox!.x + buttonBox!.width).toBeLessThanOrEqual(imageBox!.x + imageBox!.width + 1);
        expect(buttonBox!.y + buttonBox!.height).toBeLessThanOrEqual(imageBox!.y + imageBox!.height + 1);
      }
      await productsTab.click();
      const productImageBox = await productCard.locator('.product-image').boundingBox();
      const productButtonBox = await productCard.getByRole('button', { name: 'Додати в обране' }).boundingBox();
      expect(productImageBox && productButtonBox).toBeTruthy();
      expect(productButtonBox!.x + productButtonBox!.width).toBeLessThanOrEqual(productImageBox!.x + productImageBox!.width + 1);
      expect(productButtonBox!.y + productButtonBox!.height).toBeLessThanOrEqual(productImageBox!.y + productImageBox!.height + 1);
    }
    await viewerPage.setViewportSize({ width: 1440, height: 900 });
    const profileUrl = viewerPage.url();
    await productCard.getByRole('button', { name: 'Додати в обране' }).click();
    await expect(productCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible();
    expect(viewerPage.url()).toBe(profileUrl);
    await requestsTab.click();
    await requestCard.getByRole('button', { name: 'Додати в обране' }).click();
    await expect(requestCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible();
    expect(viewerPage.url()).toBe(profileUrl);
    await viewerPage.reload();
    await expect(productCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible();
    await requestsTab.click();
    await expect(requestCard.getByRole('button', { name: 'Прибрати з обраного' })).toBeVisible();
    await viewerPage.screenshot({ path: `${screenshotDir}/favorites-active-1440.png`, fullPage: true });
    await requestCard.getByRole('button', { name: 'Прибрати з обраного' }).click();
    await expect(requestCard.getByRole('button', { name: 'Додати в обране' })).toBeVisible();
    await productsTab.click();
    await productCard.getByRole('button', { name: 'Прибрати з обраного' }).click();
    await expect(productCard.getByRole('button', { name: 'Додати в обране' })).toBeVisible();
    const guest = await browser.newContext({ viewport: { width: 390, height: 800 } });
    try {
      const guestPage = await guest.newPage();
      await guestPage.goto(`/profiles/${credentials('Hybrid').username}`, { waitUntil: 'domcontentloaded', timeout: 60_000 });
      await guestPage.locator('.product-card').filter({ hasText: productTitle }).getByRole('button', { name: 'Додати в обране' }).click();
      await expect(guestPage).toHaveURL(/\/auth\/login\?return=/);
    } finally { await guest.close(); }
    expect(errors).toEqual([]);
  } finally {
    await Promise.allSettled([owner.close(), viewer.close()]);
    const db = new Client({ connectionString: process.env.DATABASE_URL });
    await db.connect();
    try {
      for (const id of requestIds) await db.query('DELETE FROM buy_requests WHERE id = $1', [id]);
      for (const id of productIds) await db.query('DELETE FROM products WHERE id = $1', [id]);
      if (!requestIds.length) await db.query('DELETE FROM buy_requests WHERE title = $1', [requestTitle]);
      if (!productIds.length) await db.query('DELETE FROM products WHERE title = $1', [productTitle]);
    } finally { await db.end(); }
  }
});
