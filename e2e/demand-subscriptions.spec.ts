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
  { code: 'rivne-namesake', name: 'Рівне', type: 'village', district: 'Ковельський район', region: 'Волинська область', community: 'Рівненська' },
  { code: 'kyiv', name: 'Київ', type: 'city', district: '', region: 'місто Київ', community: 'Київська' },
];
type Subscription = Partial<SubscriptionCriteria> & { id: string; category: { id: string; name: string }; region: string | null; active: boolean };

// UI fixtures only: backend matching, authorization and persistence are tested against real DB.
async function fixture(page: Page, initial: Subscription[] = []) {
  let subscriptions = [...initial];
  let failLoad = false;
  let failMutation = false;
  let failBoundary = false;
  let readAt: string | null = null;
  let matchReads = 0;
  const savedSubscriptions: Record<string, unknown>[] = [];
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
    if (path.endsWith('/matches') && path.startsWith('/api/demand-subscriptions/')) {
      matchReads++;
      const subscription = subscriptions.find(item => item.id === path.split('/')[3]);
      const markers = Array.from({ length: 7 }, (_, index) => ({ id: index === 0 ? requestId : 'matched-' + index, kind: 'buyRequest', title: 'Відповідний запит ' + (index + 1), geoZone: 'Рівне', category: categories[1], latitude: 50.62 + index * .001, longitude: 26.25 + index * .001, approximate: true, distanceBand: 'понад 20 км', quantity: 10, unit: 'kg' }));
      return route.fulfill({ json: { subscription, count: 7, markers, unmappedRequests: [] } });
    }
    if (path.startsWith('/api/demand-subscriptions')) {
      if (method === 'GET') return route.fulfill(failLoad ? { status: 503, json: { message: 'Помилка завантаження' } } : { json: { subscriptions } });
      if (failBoundary && data.cityOutsideKm != null) return route.fulfill({status:400,json:{error:'CITY_BOUNDARY_UNAVAILABLE',message:'Не підтверджено адміністративні межі: Рівне. Вимкніть врахування передмістя.'}});
      if (failMutation) return route.fulfill({ status: 503, json: { message: 'Помилка збереження' } });
      const id = path.split('/')[3];
      if (method === 'DELETE') { subscriptions = subscriptions.filter(item => item.id !== id); return route.fulfill({ status: 204 }); }
      savedSubscriptions.push(data);
      const existing = subscriptions.find(item => item.id === id);
      const chosen = categories.find(item => item.id === data.categoryId);
      const subscription: Subscription = { ...existing, ...data, matchCount: 7, id: id ?? `fixture-${subscriptions.length}`, category: chosen ?? existing!.category,
        countryCode: 'countryCodes' in data ? data.countryCodes[0] ?? null : existing?.countryCode ?? null,
        settlements: cities.filter(city => (data.settlementCodes ?? existing?.settlementCodes ?? []).includes(city.code)),
        region: 'regions' in data ? data.regions[0] ?? null : existing?.region ?? null, active: 'active' in data ? data.active : existing?.active ?? true };
      subscriptions = existing ? subscriptions.map(item => item.id === id ? subscription : item) : [subscription, ...subscriptions];
      return route.fulfill({ status: existing ? 200 : 201, json: { subscription } });
    }
    if (path === '/api/notifications/read') { readAt = new Date().toISOString(); return route.fulfill({ json: { ok: true } }); }
    if (path === '/api/notifications') return route.fulfill({ json: { notifications: [{ id: 'alert-fixture', type: 'system', title: 'Новий запит у категорії Мед', body: 'Перегляньте запит покупця.', context: 'selling', orderId: null, conversationId: null, buyRequestId: requestId, readAt, createdAt: new Date().toISOString() }], unreadCounts: { total: readAt ? 0 : 1, buying: 0, selling: readAt ? 0 : 1 } } });
    if (path === `/api/buy-requests/${requestId}`) return route.fulfill({ json: { buyRequest: { id: requestId, title: 'Потрібен мед у Рівному', description: '', category: { name: 'Мед' }, geoArea: 'Рівне', status: 'open', buyer: { id: 'buyer-fixture', username: 'Покупець QA' }, quantity: 10, unit: 'kg', fulfillmentMode: 'multiple_sellers', price: { min: 1, max: 200, currency: 'UAH' }, receiptMethod: 'SELLER_DELIVERY', countryCode: 'UA', delivery: { required: true, preferred: 'seller_delivery' } } } });
    if (path.startsWith('/api/profiles/')) return route.fulfill({ json: { profile: { id: 'buyer-fixture', username: 'Покупець QA', createdAt: new Date().toISOString(), statistics: { listingsCount: 0, completedDealsCount: 0 }, ratingSummary: { average: null, count: 0 } } } });
    return route.fulfill({ json: {} });
  });
  return { createdRequests, savedSubscriptions, matchReads: () => matchReads, failBoundary: (value:boolean) => { failBoundary=value; }, failLoad: (value: boolean) => { failLoad = value; }, failMutation: (value: boolean) => { failMutation = value; } };
}

async function chooseTerritory(page: Page, query: string, option: string | RegExp = query + ' — вся область') {
  await page.getByRole('combobox', { name: 'Країна, область або населений пункт', exact: true }).fill(query);
  await page.getByRole('option', { name: option, exact: typeof option === 'string' }).click();
}

async function noOverflow(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of await page.locator('.demand-subscriptions button:visible, .demand-subscriptions input:visible, .demand-subscriptions select:visible, .demand-subscriptions a:visible').all()) {
    const box = await control.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
}

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`subscription CRUD and responsive layout ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
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
    await chooseTerritory(page, 'Рівненська область');
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
    await page.getByRole('button', { name: 'Прибрати Рівненська область', exact: true }).click();
    for (const name of ['Рівне', 'Київ']) {
      await page.getByRole('combobox', { name: 'Країна, область або населений пункт' }).fill(name);
      await page.getByRole('option', { name: new RegExp(`місто, ${name},`) }).click();
    }
    await expect(page.getByRole('list', { name: 'Вибрані території' }).locator('li')).toHaveCount(2);
    await page.getByLabel('Кількість від', { exact: true }).fill('10');
    await page.getByLabel('Кількість до', { exact: true }).fill('50');
    await page.getByRole('combobox', { name: 'Одиниця', exact: true }).selectOption('kg');
    await page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true }).fill('170');
    await page.getByRole('combobox', { name: 'Валюта', exact: true }).selectOption('UAH');
    await page.getByRole('checkbox', { name: /Доставка продавцем/ }).check();
    await page.getByRole('checkbox', { name: /Самовивіз/ }).uncheck();
    await page.getByRole('checkbox', { name: /Доставка продавцем/ }).click();
    await expect(page.getByRole('checkbox', { name: /Доставка продавцем/ })).toBeChecked();
    await expect(page.getByRole('alert')).toContainText('Щонайменше один');
    await page.getByRole('checkbox', { name: 'Враховувати передмістя' }).check();
    await page.getByRole('slider', { name: 'Відстань за межами міста' }).fill('20');
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`subscription-criteria-${width}.png`), fullPage: true });
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(card).toContainText('Територія: Вибрані міста');
    await expect(card).toContainText('Київ (місто Київ)');
    await expect(card).toContainText('Кількість: 10 — 50');
    await expect(card).toContainText('170');
    await expect(card).toContainText('Доставка продавцем');
    await expect(card).toContainText('Передмістя: до 20 км');
    expect(state.savedSubscriptions.at(-1)).toMatchObject({countryCodes:[],regions:[],settlementCodes:['rivne','kyiv'],cityOutsideKm:20,center:null,radiusKm:null,receiptMethods:['SELLER_DELIVERY']});
    await page.reload();
    await expect(card).toContainText('Територія: Вибрані міста');
    await card.getByRole('button', { name: 'Редагувати' }).click();
    await expect(page.getByLabel('Кількість від', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('Кількість до', { exact: true })).toHaveValue('50');
    await expect(page.getByRole('combobox', { name: 'Одиниця', exact: true })).toHaveValue('kg');
    await expect(page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true })).toHaveValue('170');
    await expect(page.getByRole('combobox', { name: 'Валюта', exact: true })).toHaveValue('UAH');
    await expect(page.getByRole('checkbox', { name: /Доставка продавцем/ })).toBeChecked();
    await expect(page.getByRole('slider', { name: 'Відстань за межами міста' })).toHaveValue('20');
    await expect(page.getByRole('checkbox', { name: /Самовивіз/ })).not.toBeChecked();
    await page.getByRole('button', { name: 'Прибрати Київ' }).click();
    await expect(page.getByRole('list', { name: 'Вибрані території' }).locator('li')).toHaveCount(1);
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(card).not.toContainText('Київ');
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Обладнання');
    await noOverflow(page);
    await page.getByRole('option', { name: /Обладнання та інструменти/ }).click();
    await chooseTerritory(page, 'Україна', 'Україна');
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(page.locator('.subscription-card')).toHaveCount(2);
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`subscription-list-${width}.png`), fullPage: true });
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/matches') && response.status() === 200),
      card.getByRole('link', { name: 'Збігів: 7' }).click(),
    ]);
    await expect(page.getByRole('heading', { name: 'Збіги підписки: Мед' })).toBeVisible();
    await expect(page.getByText('Передмістя: до 20 км', { exact: true })).toBeVisible();
    await page.getByText('Значення пошуку за підпискою', { exact: true }).click();
    await expect(page.getByLabel('Кількість від', { exact: true })).toHaveValue('10');
    await expect(page.getByLabel('Кількість до', { exact: true })).toHaveValue('50');
    await expect(page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true })).toHaveValue('170');
    await expect(page.getByRole('combobox', { name: 'Одиниця', exact: true })).toHaveValue('kg');
    await expect(page.getByRole('combobox', { name: 'Валюта', exact: true })).toHaveValue('UAH');
    await expect(page.getByRole('slider', { name: 'Відстань за межами міста' })).toHaveValue('20');
    await expect(page.getByRole('checkbox', { name: /Доставка продавцем/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Самовивіз/ })).not.toBeChecked();
    await noOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`subscription-search-values-${width}.png`), fullPage: true });
    await page.goto('/settings/demand-subscriptions');
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

test('minimal country, region and city subscriptions need no quantity or price and default to both receipt methods', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await fixture(page);
  await page.goto('/settings/demand-subscriptions');
  for (const geography of ['country', 'region', 'city']) {
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await page.getByRole('option', { name: 'Сільське господарство › Мед' }).click();
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    await expect(page.getByRole('alert')).toContainText('Оберіть країну, область або місто');
    if (geography === 'country') await chooseTerritory(page, 'Польща', 'Польща');
    if (geography === 'region') await chooseTerritory(page, 'Рівненська область');
    if (geography === 'city') {
      await page.getByRole('combobox', { name: 'Країна, область або населений пункт' }).fill('Рівне');
      await page.getByRole('option', { name: /місто, Рівне,/ }).click();
    }
    await expect(page.getByLabel('Кількість від', { exact: true })).toHaveValue('');
    await expect(page.getByLabel('Прийнятна ціна від, за одиницю', { exact: true })).toHaveValue('');
    await expect(page.getByRole('checkbox', { name: /Самовивіз/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Доставка продавцем/ })).toBeChecked();
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
  await chooseTerritory(page, 'Україна', 'Україна');
  state.failMutation(true);
  await page.getByRole('button', { name: 'Зберегти підписку' }).click();
  await expect(page.getByRole('alert')).toContainText('Помилка збереження');
  await expect(page.getByRole('combobox', { name: 'Пошук або вибір категорії' })).toHaveValue('Сільське господарство › Мед');
  state.failMutation(false);
  await page.getByRole('button', { name: 'Зберегти підписку' }).click();
  await expect(page.getByRole('article', { name: 'Підписка: Мед' })).toBeVisible();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

 test('country covers lower levels, keyboard city selection blocks duplicates and handles optional validation', async ({page}, testInfo) => {
  await page.setViewportSize({width:320,height:900});
  const state = await fixture(page);
  await page.goto('/settings/demand-subscriptions');
  await page.getByRole('button',{name:'Додати підписку'}).click();
  await page.getByRole('combobox',{name:'Пошук або вибір категорії'}).fill('Мед');
  await page.getByRole('option',{name:'Сільське господарство › Мед',exact:true}).click();
  await expect(page.getByRole('combobox',{name:'Область',exact:true})).toHaveCount(0);
  await expect(page.getByRole('combobox',{name:'Країна',exact:true})).toHaveCount(0);
  const picker = page.getByRole('combobox',{name:'Країна, область або населений пункт'});
  await picker.fill('Рівне');
  await expect(page.getByRole('option',{name:/місто, Рівне,/})).toBeVisible();
  await expect(page.getByRole('option',{name:/село, Рівне, Ковельський район, Волинська область/})).toBeVisible();
  await page.screenshot({path:testInfo.outputPath('subscription-namesakes-320.png'),fullPage:true});
  await picker.press('ArrowDown'); await picker.press('ArrowDown'); await picker.press('Enter');
  await expect(page.getByRole('list',{name:'Вибрані території'}).locator('li')).toHaveCount(1);
  await picker.fill('Рівне');
  await page.getByRole('option',{name:/місто, Рівне,/}).click();
  await expect(page.getByRole('alert')).toContainText('уже вибрано');
  await expect(page.getByRole('list',{name:'Вибрані території'}).locator('li')).toHaveCount(1);
  await chooseTerritory(page, 'Рівненська область');
  await expect(page.getByRole('list',{name:'Вибрані території'}).locator('li')).toHaveCount(1);
  await expect(page.getByRole('checkbox',{name:'Враховувати передмістя'})).toBeDisabled();
  await picker.fill('Київ'); await page.getByRole('option',{name:/місто, Київ,/}).click();
  await expect(page.getByRole('list',{name:'Вибрані території'})).toContainText('місто Київ');
  await page.getByRole('checkbox',{name:'Враховувати передмістя'}).check();
  await page.getByRole('checkbox',{name:'Враховувати передмістя'}).uncheck();
  await expect(page.getByRole('list',{name:'Вибрані території'}).locator('li')).toHaveCount(2);
  await page.getByLabel('Кількість від',{exact:true}).fill('10');
  await page.getByRole('button',{name:'Зберегти підписку'}).click();
  await expect(page.getByRole('alert')).toContainText('Оберіть одиницю');
  await page.getByRole('combobox',{name:'Одиниця',exact:true}).selectOption('kg');
  await page.getByLabel('Прийнятна ціна від, за одиницю',{exact:true}).fill('200');
  await page.getByRole('button',{name:'Зберегти підписку'}).click();
  await expect(page.getByRole('alert')).toContainText('Оберіть валюту');
  await page.getByLabel('Кількість від',{exact:true}).fill('');
  await page.getByLabel('Прийнятна ціна від, за одиницю',{exact:true}).fill('');
  await page.getByRole('combobox',{name:'Одиниця',exact:true}).selectOption('');
  await chooseTerritory(page, 'Україна', 'Україна');
  await expect(picker).toBeVisible();
  await expect(page.getByText(/Уся Україна вже включає/)).toBeVisible();
  await page.getByRole('button',{name:'Зберегти підписку'}).click();
  expect(state.savedSubscriptions.at(-1)).toMatchObject({countryCodes:['UA'],regions:[],settlementCodes:[],cityOutsideKm:null,unit:null,currency:null,minQuantity:null,minPrice:null,receiptMethods:['SELF_PICKUP','SELLER_DELIVERY']});
  await page.getByRole('button',{name:'Редагувати',exact:true}).click();
  await expect(page.getByRole('list',{name:'Вибрані території'})).toContainText('Україна');
  await expect(page.getByRole('combobox',{name:'Одиниця',exact:true})).toHaveValue('');
  await expect(page.getByRole('combobox',{name:'Валюта',exact:true})).toHaveValue('');
  await noOverflow(page);
 });

 test('unavailable administrative boundary preserves cities and allows saving without suburbs', async ({page}) => {
  await page.setViewportSize({width:390,height:900});
  const state = await fixture(page); state.failBoundary(true);
  await page.goto('/settings/demand-subscriptions');
  await page.getByRole('button',{name:'Додати підписку'}).click();
  await page.getByRole('combobox',{name:'Пошук або вибір категорії'}).fill('Мед');
  await page.getByRole('option',{name:'Сільське господарство › Мед',exact:true}).click();
  await page.getByRole('combobox',{name:'Країна, область або населений пункт'}).fill('Рівне');
  await page.getByRole('option',{name:/місто, Рівне,/}).click();
  await page.getByRole('checkbox',{name:'Враховувати передмістя'}).check();
  await page.getByRole('button',{name:'Зберегти підписку'}).click();
  await expect(page.getByRole('alert')).toContainText('Не підтверджено адміністративні межі');
  await expect(page.getByRole('list',{name:'Вибрані території'})).toContainText('Рівненська область');
  await page.getByRole('checkbox',{name:'Враховувати передмістя'}).uncheck();
  await page.getByRole('button',{name:'Зберегти підписку'}).click();
  expect(state.savedSubscriptions.at(-1)).toMatchObject({settlementCodes:['rivne'],cityOutsideKm:null});
  await expect(page.getByRole('article',{name:'Підписка: Мед',exact:true})).toContainText('Рівне');
  await noOverflow(page);
 });

for (const width of [1440, 1024, 768, 390, 320]) {
  test(`one input retains multiple regions and opens all counted matches ${width}px`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width, height: 900 });
    const state = await fixture(page);
    await page.goto('/settings/demand-subscriptions');
    await page.getByRole('button', { name: 'Додати підписку' }).click();
    await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await page.getByRole('option', { name: 'Сільське господарство › Мед', exact: true }).click();
    await chooseTerritory(page, 'Рівненська область');
    await chooseTerritory(page, 'місто Київ');
    await expect(page.getByRole('list', { name: 'Вибрані території' }).locator('li')).toHaveCount(2);
    await chooseTerritory(page, 'Рівне', /місто, Рівне,/);
    await expect(page.getByRole('alert')).toContainText('уже включений');
    await page.getByRole('button', { name: 'Зберегти підписку' }).click();
    expect(state.savedSubscriptions.at(-1)).toMatchObject({ countryCodes: [], regions: ['Рівненська область', 'місто Київ'], settlementCodes: [] });
    await page.reload();
    const card = page.getByRole('article', { name: 'Підписка: Мед' });
    await expect(card).toContainText('Рівненська область, місто Київ');
    await card.getByRole('button', { name: 'Редагувати' }).click();
    await expect(page.getByRole('list', { name: 'Вибрані території' }).locator('li')).toHaveCount(2);
    await page.getByRole('button', { name: 'Скасувати', exact: true }).click();
    await expect(card.getByRole('link', { name: 'Збігів: 7' })).toBeVisible();
    await noOverflow(page);
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/matches') && response.status() === 200),
      card.getByRole('link', { name: 'Збігів: 7' }).click(),
    ]);
    await expect(page).toHaveURL(/\/discover\?demandSubscription=fixture-0$/);
    await expect(page.getByRole('heading', { name: 'Збіги підписки: Мед' })).toBeVisible();
    await expect(page.getByText('Знайдено: 7. Показано всі відповідні запити покупців.')).toBeVisible();
    await expect(page.locator('.map-listing-result')).toHaveCount(7);
    await page.getByText('Значення пошуку за підпискою', { exact: true }).click();
    await expect(page.getByRole('list', { name: 'Вибрані території' }).locator('li')).toHaveCount(2);
    await expect(page.getByRole('list', { name: 'Вибрані території' })).toContainText('Рівненська область');
    await expect(page.getByRole('checkbox', { name: /Самовивіз/ })).toBeChecked();
    await expect(page.getByRole('checkbox', { name: /Доставка продавцем/ })).toBeChecked();
    await page.getByText('Значення пошуку за підпискою', { exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath(`subscription-matches-${width}.png`), fullPage: true });
    await Promise.all([
      page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/matches') && response.status() === 200),
      page.reload(),
    ]);
    await expect(page.locator('.map-listing-result')).toHaveCount(7);
    const canvas = page.locator('.map-canvas');
    await canvas.scrollIntoViewIfNeeded();
    const box = (await canvas.boundingBox())!;
    await page.mouse.move(box.x + 40, box.y + 80);
    const beforePan = state.matchReads();
    const extraRead = page.waitForRequest(request => new URL(request.url()).pathname.endsWith('/matches'), { timeout: 2000 }).then(() => true, () => false);
    await page.mouse.down();
    await page.mouse.move(box.x + 150, box.y + 130, { steps: 8 });
    await page.mouse.up();
    expect(await extraRead).toBe(false);
    expect(state.matchReads()).toBe(beforePan);
    await expect(page.locator('.map-listing-result')).toHaveCount(7);
    expect((await page.locator('.map-listing-result').allTextContents()).join(' ')).not.toContain('понад 20 км');
  });
}
