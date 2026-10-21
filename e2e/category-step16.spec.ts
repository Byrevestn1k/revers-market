import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

test.setTimeout(240_000);
const account = async (section: string) => {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error('Local QA account unavailable');
  return { username, password };
};
const login = async (page: Page, section: string, destination: string) => {
  const credentials = await account(section);
  await page.goto('/auth/login?return=' + encodeURIComponent(destination));
  await page.locator('input[name="username"]').fill(credentials.username);
  await page.locator('input[name="password"]').fill(credentials.password);
  await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
  await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/') + '$'), { timeout: 30_000 });
};
const selectCategory = async (page: Page, name: RegExp) => {
  const input = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
  await input.fill(name.source.replaceAll('\\', '').replaceAll('$', ''));
  await page.getByRole('option', { name: 'Авто › Легкові автомобілі Має підкатегорії' }).click();
};
const checkFormWidth = async (page: Page, width: number) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `Form overflow at ${width}`).toBe(true);
  for (const selector of ['input[name="title"]', '.category-picker input[role="combobox"]', 'textarea[name="description"]', '.category-recommendation', '.listing-form-actions button, .deal-actions button']) {
    const control = page.locator(selector).first();
    if (!await control.isVisible()) continue;
    const box = await control.boundingBox();
    expect(box && box.x >= -1 && box.x + box.width <= width + 1, `${selector} clipped at ${width}`).toBe(true);
  }
};

test('real category recommendation, blocked product and request, report and responsive forms', async ({ browser }) => {
  if (!process.env.DATABASE_URL) throw new Error('Real local PostgreSQL required');
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  const title = `Мед натуральний Step16 ${Date.now()}`;
  let productId: string | undefined, toyId: string | undefined, giftId: string | undefined, requestId: string | undefined, offerId: string | undefined, decisionId: string | undefined;
  const decisionIds: string[] = [];
  try {
    await login(page, 'Hybrid', '/my/products/new');
    await page.locator('input[name="title"]').fill('Насос універсальний Step16');
    await selectCategory(page, /Легкові автомобілі$/);
    await page.waitForTimeout(850);
    await expect(page.locator('.category-recommendation')).toContainText('Категорію не вдалося визначити точно');
    await page.locator('input[name="title"]').fill(title);
    await expect(page.locator('.category-recommendation')).toContainText('Мед');
    await selectCategory(page, /Легкові автомобілі$/);
    await expect(page.locator('.category-recommendation')).toContainText('Обрана категорія не відповідає товару');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.locator('.category-recommendation')).toBeVisible();
      await checkFormWidth(page, width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('input[name="quantity"]').fill('1');
    await page.locator('input[name="price"]').fill('100');
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    const denied = page.waitForResponse(response => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const denial = await denied;
    expect(denial.status()).toBe(422);
    decisionId = (await denial.json()).decisionId;
    expect(decisionId).toBeTruthy();
    decisionIds.push(decisionId);
    await expect(page.locator('input[name="title"]')).toHaveValue(title);
    const appealed = page.waitForResponse(response => new URL(response.url()).pathname === '/api/category-appeals' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Оскаржити відхилення' }).click();
    expect((await appealed).status()).toBe(201);
    await expect(page.getByText('Оскарження збережено для розгляду.')).toBeVisible();
    await page.locator('.category-recommendation').getByRole('button', { name: /› Мед$/ }).click();
    const published = page.waitForResponse(response => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const productResponse = await published;
    expect(productResponse.status(), await productResponse.text()).toBe(201);
    productId = (await productResponse.json()).product.id;
    await page.setViewportSize({ width: 390, height: 850 });
    await page.goto('/my/products/new');
    await page.locator('input[name="title"]').fill(`Іграшковий автомобіль Toyota Step16 ${Date.now()}`);
    const toyPicker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
    await toyPicker.fill('Іграшковий транспорт');
    await page.getByRole('option', { name: /Іграшковий транспорт/ }).last().click();
    await page.locator('input[name="quantity"]').fill('1');
    await page.locator('input[name="price"]').fill('100');
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await checkFormWidth(page, 390);
    const toyPublished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const toyResponse = await toyPublished;
    expect(toyResponse.status(), await toyResponse.text()).toBe(201);
    toyId = (await toyResponse.json()).product.id;
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/my/products/new');
    await page.locator('input[name="title"]').fill(`Яблука Голден, велосипед Trek у подарунок Step16 ${Date.now()}`);
    const giftPicker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
    await giftPicker.fill('Яблука');
    await page.getByRole('option', { name: /› Яблука$/ }).last().click();
    await page.locator('input[name="quantity"]').fill('1');
    await page.locator('input[name="price"]').fill('100');
    await page.getByRole('checkbox', { name: 'Поштова доставка' }).check();
    await checkFormWidth(page, 1440);
    const giftPublished = page.waitForResponse(response => new URL(response.url()).pathname === '/api/products' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати товар' }).click();
    const giftResponse = await giftPublished;
    expect(giftResponse.status(), await giftResponse.text()).toBe(201);
    giftId = (await giftResponse.json()).product.id;
    await page.goto('/products/' + productId);
    await expect(page.getByRole('heading', { name: title })).toBeVisible();
    await page.goto(`/my/products/${productId}/edit`);
    await expect(page.locator('input[name="title"]')).toHaveValue(title);
    await page.locator('input[name="title"]').fill('Велосипед Trek Step16');
    await expect(page.locator('.category-recommendation')).toContainText('Обрана категорія не відповідає товару');
    const rejectedEdit = page.waitForResponse(response => new URL(response.url()).pathname === `/api/products/${productId}` && response.request().method() === 'PATCH');
    await page.getByRole('button', { name: 'Зберегти зміни' }).click();
    const editDenial = await rejectedEdit;
    expect(editDenial.status()).toBe(422);
    decisionIds.push((await editDenial.json()).decisionId);
    await page.goto('/products?q=' + encodeURIComponent(title.split(' ').at(-1)!));
    await expect(page.getByText(title, { exact: true }).first()).toBeVisible();
    await page.goto('/my/requests/new');
    await page.locator('input[name="title"]').fill(`Куплю мед Step16 ${Date.now()}`);
    await selectCategory(page, /Легкові автомобілі$/);
    await expect(page.locator('.category-recommendation')).toContainText('Обрана категорія не відповідає товару');
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await checkFormWidth(page, width);
    }
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('input[name="quantity"]').fill('1');
    await page.getByRole('radio', { name: /Можна кількома продавцями/ }).check();
    await page.getByRole('checkbox', { name: 'Можна домовитися' }).check();
    const badRequest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/buy-requests' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати запит' }).click();
    const requestDenial = await badRequest;
    expect(requestDenial.status()).toBe(422);
    decisionIds.push((await requestDenial.json()).decisionId);
    await page.locator('.category-recommendation').getByRole('button', { name: /› Мед$/ }).click();
    const goodRequest = page.waitForResponse(response => new URL(response.url()).pathname === '/api/buy-requests' && response.request().method() === 'POST');
    await page.getByRole('button', { name: 'Опублікувати запит' }).click();
    const requestResponse = await goodRequest;
    expect(requestResponse.status(), await requestResponse.text()).toBe(201);
    requestId = (await requestResponse.json()).buyRequest.id;
    await page.goto('/buy-requests/' + requestId);
    await expect(page.getByRole('heading', { name: /Куплю мед Step16/ })).toBeVisible();
    const viewer = await browser.newContext({ viewport: { width: 390, height: 850 } });
    const otherPage = await viewer.newPage();
    try {
      await login(otherPage, 'Buyer A', '/products/' + productId);
      await otherPage.getByRole('button', { name: 'Поскаржитися на категорію' }).click();
      await otherPage.getByRole('textbox', { name: 'Коментар (необов’язково)' }).fill('Тестова скарга Step16');
      const report = otherPage.waitForResponse(response => new URL(response.url()).pathname === '/api/reports' && response.request().method() === 'POST');
      await otherPage.getByRole('button', { name: 'Надіслати скаргу' }).click();
      expect((await report).status()).toBe(201);
      await expect(otherPage.getByText('Скаргу збережено для розгляду.')).toBeVisible();
    } finally { await viewer.close(); }
    const seller = await browser.newContext({ viewport: { width: 390, height: 850 } });
    const sellerPage = await seller.newPage();
    try {
      await login(sellerPage, 'Seller A', '/buy-requests/' + requestId);
      await sellerPage.getByRole('button', { name: 'Запропонувати товар' }).click();
      const offerForm = sellerPage.locator('.seller-offer-form');
      await offerForm.getByLabel(/Ціна за/).fill('100');
      await offerForm.getByRole('checkbox', { name: 'Можна домовитися' }).check();
      await offerForm.getByRole('button', { name: 'Переглянути умови' }).click();
      const createdOffer = sellerPage.waitForResponse(response => new URL(response.url()).pathname === `/api/buy-requests/${requestId}/offers` && response.request().method() === 'POST');
      await offerForm.getByRole('button', { name: 'Надіслати пропозицію' }).click();
      const offerResponse = await createdOffer;
      expect(offerResponse.status(), await offerResponse.text()).toBe(201);
      offerId = (await offerResponse.json()).offer.id;
      await expect(offerForm).toHaveCount(0);
    } finally { await seller.close(); }
  } finally {
    await context.close();
    if (productId || toyId || giftId || requestId || decisionIds.length) {
      const client = new Client({ connectionString: process.env.DATABASE_URL });
      await client.connect();
      try {
        if (offerId) await client.query('DELETE FROM offers WHERE id = $1', [offerId]);
        if (decisionIds.length) await client.query('DELETE FROM category_appeals WHERE decision_id = ANY($1::uuid[])', [decisionIds]);
        if (decisionIds.length) await client.query('DELETE FROM category_block_decisions WHERE id = ANY($1::uuid[])', [decisionIds]);
        if (requestId) await client.query("DELETE FROM reports WHERE target_type = 'buy_request' AND target_id = $1", [requestId]);
        if (productId) await client.query("DELETE FROM reports WHERE target_type = 'product' AND target_id = $1", [productId]);
        if (requestId) await client.query('DELETE FROM buy_requests WHERE id = $1 AND buyer_id = (SELECT id FROM users WHERE username = $2)', [requestId, (await account('Hybrid')).username]);
        if (productId) await client.query('DELETE FROM products WHERE id = $1 AND owner_id = (SELECT id FROM users WHERE username = $2)', [productId, (await account('Hybrid')).username]);
        if (toyId) await client.query('DELETE FROM products WHERE id = $1 AND owner_id = (SELECT id FROM users WHERE username = $2)', [toyId, (await account('Hybrid')).username]);
        if (giftId) await client.query('DELETE FROM products WHERE id = $1 AND owner_id = (SELECT id FROM users WHERE username = $2)', [giftId, (await account('Hybrid')).username]);
      } finally { await client.end(); }
    }
  }
});
