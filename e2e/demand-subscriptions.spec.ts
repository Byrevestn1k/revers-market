import { expect, test, type Page } from '@playwright/test';
import type { SubscriptionCriteria } from '../frontend/src/subscription-criteria';

const categoryId = '11111111-1111-4111-8111-111111111111';
const parentId = '22222222-2222-4222-8222-222222222222';
const longId = '33333333-3333-4333-8333-333333333333';
const requestId = '44444444-4444-4444-8444-444444444444';
const categories = [
  { id: parentId, name: 'Сільське господарство', parentId: null },
  { id: categoryId, name: 'Мед', parentId },
  { id: longId, name: 'Обладнання та інструменти для фермерського господарства з довгою назвою', parentId },
];
const cities = [
  { code: 'rivne', name: 'Рівне', type: 'city', district: 'Рівненський район', region: 'Рівненська область', community: 'Рівненська' },
  { code: 'kyiv', name: 'Київ', type: 'city', district: '', region: 'місто Київ', community: 'Київська' },
];
type Subscription = Partial<SubscriptionCriteria> & { id: string; category: { id: string; name: string }; region: string | null; active: boolean };

// UI fixtures only: backend matching, authorization and persistence are tested against real DB.
async function fixture(page: Page, initial: Subscription[] = []) {
  let subscriptions = [...initial];
  let failLoad = false;
  let failMutation = false;
  let readAt: string | null = null;
  const createdRequests: Record<string, unknown>[] = [];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    const data = method === 'GET' ? {} : route.request().postDataJSON() ?? {};
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'seller-fixture', username: 'Продавець QA' } } });
    if (path === '/api/categories') return route.fulfill({ json: { categories } });
    if (path === '/api/settlements') {
      const query = new URL(route.request().url()).searchParams;
      if (query.get('mode') === 'regions') return route.fulfill({ json: { regions: ['місто Київ', 'Рівненська область'] } });
      const settlements = cities.filter(city => query.has('q') ? city.name.toLowerCase().includes(query.get('q')!.toLowerCase()) : city.region === query.get('region'));
      return route.fulfill({ json: { settlements, total: settlements.length } });
    }
    if (path === '/api/profile/me') return route.fulfill({ json: { profile: { avatarUrl: null, settlement: cities[0], mapLocation: { mode: 'pin', latitude: 50.62, longitude: 26.25 } } } });
    if (path === '/api/buy-requests') {
      if (method === 'POST') { createdRequests.push(data); return route.fulfill({ status: 201, json: { buyRequest: { id: requestId } } }); }
      return route.fulfill({ json: { buyRequests: [], pagination: { page: 1, pages: 1 } } });
    }
    if (path.startsWith('/api/products')) return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } });
    if (path === '/api/conversations') return route.fulfill({ json: { conversations: [] } });
    if (path.startsWith('/api/demand-subscriptions')) {
      if (method === 'GET') return route.fulfill(failLoad ? { status: 503, json: { message: 'Помилка завантаження' } } : { json: { subscriptions } });
      if (failMutation) return route.fulfill({ status: 503, json: { message: 'Помилка збереження' } });
      const id = path.split('/')[3];
      if (method === 'DELETE') { subscriptions = subscriptions.filter(item => item.id !== id); return route.fulfill({ status: 204 }); }
      const existing = subscriptions.find(item => item.id === id);
      const chosen = categories.find(item => item.id === data.categoryId);
      const subscription: Subscription = { ...existing, ...data, id: id ?? `fixture-${subscriptions.length}`, category: chosen ?? existing!.category,
        countryCode: data.countryCode ?? existing?.countryCode ?? (data.region || data.settlementCodes?.length ? 'UA' : null),
        settlements: cities.filter(city => (data.settlementCodes ?? existing?.settlementCodes ?? []).includes(city.code)),
        region: 'region' in data ? data.region : existing?.region ?? null, active: 'active' in data ? data.active : existing?.active ?? true };
      subscriptions = existing ? subscriptions.map(item => item.id === id ? subscription : item) : [subscription, ...subscriptions];
      return route.fulfill({ status: existing ? 200 : 201, json: { subscription } });
    }
    if (path === '/api/notifications/read') { readAt = new Date().toISOString(); return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/notifications') return route.fulfill({ json: { notifications: [{ id: 'alert-fixture', type: 'system', title: 'Новий запит у категорії Мед', body: 'Перегляньте запит покупця.', context: 'selling', orderId: null, conversationId: null, buyRequestId: requestId, readAt, createdAt: new Date().toISOString() }], unreadCounts: { total: readAt ? 0 : 1, buying: 0, selling: readAt ? 0 : 1 } } });
    if (path === `/api/buy-requests/${requestId}`) return route.fulfill({ json: { buyRequest: { id: requestId, title: 'Потрібен мед у Рівному', description: '', category: { name: 'Мед' }, geoArea: 'Рівне', status: 'open', buyer: { id: 'buyer-fixture', username: 'Покупець QA' }, quantity: 10, unit: 'kg', fulfillmentMode: 'multiple_sellers', price: { min: 1, max: 200, currency: 'UAH' }, receiptMethod: 'SELLER_DELIVERY', countryCode: 'UA', delivery: { required: true, preferred: 'seller_delivery' } } } });
    if (path.startsWith('/api/profiles/')) return route.fulfill({ json: { profile: { id: 'buyer-fixture', username: 'Покупець QA', createdAt: new Date().toISOString(), statistics: { listingsCount: 0, completedDealsCount: 0 }, ratingSummary: { average: null, count: 0 } } } });
    return route.fulfill({ json: {} });
  });
  return { createdRequests, failLoad: (value: boolean) => { failLoad = value; }, failMutation: (value: boolean) => { failMutation = value; } };
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of await page.locator('.demand-subscriptions button:visible, .demand-subscriptions input:visible, .demand-subscriptions select:visible').all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`subscription CRUD and responsive layout ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    await fixture(page);
    await page.goto('/settings/demand-subscriptions');
    await expect(page.getByRole('heading', { name: 'Підписки на запити', exact: true })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'У вас ще немає підписок' })).toBeVisible();
    await noOverflow(page);
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(page.getByRole('alert')).toContainText('Оберіть категорію');
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await expect(page.getByRole('option', { name: 'Сільське господарство › Мед', exact: true })).toBeVisible();
    await noOverflow(page);
    await page.getByRole('option', { name: 'Сільське господарство › Мед', exact: true }).click();
    await expect(page.getByRole('alert')).toHaveCount(0);
    await page.getByRole('combobox', { name: 'Область', exact: true }).selectOption('Рівненська область');
    await page.screenshot({ path: testInfo.outputPath(`subscription-form-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    const card = page.getByRole('article', { name: 'Підписка: Мед', exact: true });
    await expect(card).toContainText('Рівненська область');
    await expect(card).toContainText('Статус: Активна');
    await card.getByRole('button', { name: 'Вимкнути' }).click();
    await expect(card).toContainText('Статус: Вимкнена');
    await card.getByRole('button', { name: 'Увімкнути' }).click();
    await expect(card).toContainText('Статус: Активна');
    await card.getByRole('button', { name: 'Редагувати' }).click();
    await page.getByRole('combobox', { name: 'Область', exact: true }).selectOption('');
    for (const name of ['Рівне', 'Київ']) {
      await page.getByRole('combobox', { name: 'Додати місто / населений пункт' }).fill(name);
      await page.getByRole('option', { name: new RegExp(`місто, ${name},`) }).click();
    }
    await expect(page.getByRole('list', { name: 'Вибрані міста' }).locator('li')).toHaveCount(2);
    await page.getByLabel('Кількість від', { exact: true }).fill('10');
    await page.getByLabel('Кількість до', { exact: true }).fill('50');
    await page.getByRole('combobox', { name: 'Одиниця', exact: true }).selectOption('kg');
    await page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true }).fill('170');
    await page.getByRole('combobox', { name: 'Валюта', exact: true }).selectOption('UAH');
    await page.getByRole('checkbox', { name: /Доставка продавцем/ }).check();
    await page.getByRole('checkbox', { name: 'Обмежити радіусом від точки' }).check();
    await page.getByLabel('Широта', { exact: true }).fill('50.62');
    await page.getByLabel('Довгота', { exact: true }).fill('26.25');
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`subscription-criteria-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(card).toContainText('Уся Україна');
    await expect(card).toContainText('Київ (місто Київ)');
    await expect(card).toContainText('Кількість: 10 — 50');
    await expect(card).toContainText('170');
    await expect(card).toContainText('Доставка продавцем');
    await expect(card).toContainText('Радіус: 25 км');
    await page.reload();
    await expect(card).toContainText('Уся Україна');
    await card.getByRole('button', { name: 'Редагувати' }).click();
    await expect(page.getByLabel('Кількість від', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('Кількість до', { exact: true })).toHaveValue('50');
    await expect(page.getByRole('combobox', { name: 'Одиниця', exact: true })).toHaveValue('kg');
    await expect(page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true })).toHaveValue('170');
    await expect(page.getByRole('combobox', { name: 'Валюта', exact: true })).toHaveValue('UAH');
    await expect(page.getByRole('checkbox', { name: /Доставка продавцем/ })).toBeChecked();
    await expect(page.getByLabel('Широта', { exact: true })).toHaveValue('50.62');
    await page.getByRole('button', { name: 'Прибрати Київ' }).click();
    await expect(page.getByRole('list', { name: 'Вибрані міста' }).locator('li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(card).not.toContainText('Київ');
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Обладнання');
    await noOverflow(page);
    await page.getByRole('option', { name: /Обладнання та інструменти/ }).click();
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(page.locator('.subscription-card')).toHaveCount(2);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`subscription-list-${width}.png`), fullPage: true });
    await card.getByRole('button', { name: 'Видалити' }).click();
    const dialog = page.getByRole('dialog', { name: 'Видалити підписку?' });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Скасувати' }).click();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Видалити' }).click();
    await dialog.getByRole('button', { name: 'Видалити', exact: true }).click();
    await expect(card).toHaveCount(0);
    await noOverflow(page);
  });
}

test('minimal country, region and city subscriptions need no quantity, price or receipt', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/settings/demand-subscriptions');
  for (const geography of ['country', 'region', 'city']) {
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await page.getByRole('option', { name: 'Сільське господарство › Мед' }).click();
    await page.getByRole('combobox', { name: 'Країна', exact: true }).selectOption('');
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(page.getByRole('alert')).toContainText('Оберіть країну, область або місто');
    if (geography === 'country') await page.getByRole('combobox', { name: 'Країна', exact: true }).selectOption('PL');
    if (geography === 'region') await page.getByRole('combobox', { name: 'Область', exact: true }).selectOption('Рівненська область');
    if (geography === 'city') {
      await page.getByRole('combobox', { name: 'Додати місто / населений пункт' }).fill('Рівне');
      await page.getByRole('option', { name: /місто, Рівне,/ }).click();
    }
    await expect(page.getByLabel('Кількість від', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: /Самовивіз/ })).not.toBeChecked();
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(page.getByRole('form')).toHaveCount(0);
  }
  await expect(page.locator('.subscription-card')).toHaveCount(3);
  await expect(page.locator('.subscription-list')).toContainText('Польща');
  await expect(page.locator('.subscription-list')).toContainText('Рівненська область');
  await expect(page.locator('.subscription-list')).toContainText('Міста: Рівне');
  await noOverflow(page);
});

for (const width of [1440, 390, 320]) {
  test(`Request creation uses explicit seller transport and allows missing budget ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    await page.goto('/my/requests/new');
    await page.getByRole('textbox', { name: 'Назва товару' }).fill('Потрібен мед');
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await page.getByRole('option', { name: /Мед/ }).click();
    await page.getByRole('radio', { name: /Можна кількома продавцями/ }).check();
    const receipt = page.getByRole('combobox', { name: 'Спосіб отримання', exact: true });
    await expect(receipt).toHaveValue('');
    await receipt.selectOption('SELF_PICKUP');
    await receipt.selectOption('SELLER_DELIVERY');
    expect(await receipt.locator('option').allTextContents()).toEqual([
      'Оберіть спосіб отримання', 'Самовивіз', 'Доставка продавцем',
    ]);
    await expect(page.getByText('Доставка продавцем — продавець привозить товар у місце покупця', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Країна запиту', exact: true })).toHaveValue('UA');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`request-receipt-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Опублікувати запит', exact: true }).click();
    await expect.poll(() => state.createdRequests.length).toBe(1);
    expect(state.createdRequests[0]).toMatchObject({ receiptMethod: 'SELLER_DELIVERY', countryCode: 'UA', minPrice: null, maxPrice: null });
    expect(state.createdRequests[0]).not.toHaveProperty('delivery');
  });
}

test('selling demand notification opens and refreshes its canonical Buy Request', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/notifications');
  await page.getByRole('tab', { name: /Продаж/ }).click();
  await expect(page.getByText('Новий запит у категорії Мед', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Переглянути', exact: true }).click();
  await expect(page).toHaveURL(`/buy-requests/${requestId}`);
  await expect(page.getByRole('heading', { name: 'Потрібен мед у Рівному' })).toBeVisible();
  await expect(page.getByText('Доставка продавцем — продавець привозить товар у місце покупця', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Потрібен мед у Рівному' })).toBeVisible();
});

test('subscription load and mutation errors allow retry without losing form data', async ({ page }) => {
  const state = await fixture(page);
  state.failLoad(true);
  await page.goto('/settings/demand-subscriptions');
  await expect(page.getByRole('alert')).toContainText('Помилка завантаження');
  state.failLoad(false);
  await page.getByRole('button', { name: 'Повторити' }).click();
  await page.getByRole('button', { name: 'Додати підписку' }).click();
  await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
  await page.getByRole('option', { name: 'Сільське господарство › Мед' }).click();
  state.failMutation(true);
  await page.getByRole('button', { name: 'Зберегти підписку' }).click();
  await expect(page.getByRole('alert')).toContainText('Помилка збереження');
  await expect(page.getByRole('combobox', { name: 'Пошук або вибір категорії' })).toHaveValue('Сільське господарство › Мед');
  state.failMutation(false);
  await page.getByRole('button', { name: 'Зберегти підписку' }).click();
  await expect(page.getByRole('article', { name: 'Підписка: Мед' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});
