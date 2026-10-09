import { expect, test, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import { Client } from 'pg';

// No route interception, mocked API, API login or API creation: all flow actions use UI.
test.use({ trace: 'off', timezoneId: 'Europe/Kyiv', actionTimeout: 30000, navigationTimeout: 45000 });
test.setTimeout(300000);
test.skip(process.env.STEP8_LIVE_GEO !== '1', 'Requires the isolated Step 8 real-DB environment');

const account = async (section: string) => {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error(`Missing documented QA account: ${section}`);
  return { username, password };
};
const login = async (page: Page, section: string, destination: string) => {
  const credentials = await account(section);
  await page.goto('/auth/login?return=' + encodeURIComponent(destination));
  await expect(page.locator('input[name="username"]')).toBeVisible();
  await page.locator('input[name="username"]').fill(credentials.username);
  await page.locator('input[name="password"]').fill(credentials.password);
  const authenticated = page.waitForResponse(r => new URL(r.url()).pathname === '/api/auth/login' && r.request().method() === 'POST');
  await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
  expect((await authenticated).status()).toBe(200);
  await expect(page).toHaveURL(new RegExp(destination.replaceAll('/', '\\/') + '$'));
};
const noOverflow = async (page: Page) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  for (const control of await page.locator('.notification-row button:visible,.notification-context-tabs button:visible').all()) {
    const box = (await control.boundingBox())!;
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(page.viewportSize()!.width + 1);
  }
};

for (const cityOnly of [false, true]) {
test(`real seller -> buyer -> selling alert -> canonical Request -> matches map (${cityOnly ? 'city only' : 'private point'}), all five widths`, async ({ browser }, testInfo) => {
  if (process.env.STEP8_LIVE_GEO !== '1' || !/^\/step8_final_\d+$/.test(new URL(process.env.DATABASE_URL!).pathname)) throw new Error('Use the isolated Step 8 environment and documented QA accounts');
  const buyerAccount = await account('Buyer A');
  const preparation = new Client({connectionString:process.env.DATABASE_URL}); await preparation.connect();
  let profileSnapshot: Record<string,unknown>;
  try {
    profileSnapshot = (await preparation.query('SELECT id,map_location_mode,public_latitude,public_longitude,settlement_code,location_display FROM users WHERE username=$1',[buyerAccount.username])).rows[0];
    if(!profileSnapshot)throw new Error('Documented QA buyer must exist in the isolated DB');
    await preparation.query('UPDATE users SET map_location_mode=$1,public_latitude=$2,public_longitude=$3,settlement_code=$4,location_display=$5 WHERE id=$6',[cityOnly?'approximate':'pin',cityOnly?null:50.6196175,cityOnly?null:26.2513165,'UA56060470010041018','Рівне',profileSnapshot.id]);
  } finally { await preparation.end(); }
  const sellerContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Kyiv' });
  const buyerContext = await browser.newContext({ baseURL: process.env.E2E_BASE_URL, viewport: { width: 1440, height: 900 }, timezoneId: 'Europe/Kyiv' });
  const seller = await sellerContext.newPage(), buyer = await buyerContext.newPage();
  const title = `Мед Step 8 ${Date.now()} — різнотрав’я для господарства з довгою назвою`;
  const description = 'Потрібен свіжий мед у харчовій тарі. Умови й ціну узгодимо. '.repeat(8);
  const deadline = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
  const deadlineLabel = deadline.split('-').reverse().join('.');
  let subscriptionId: string | undefined, requestId: string | undefined;
  try {
    await login(seller, 'Seller A', '/settings/demand-subscriptions'); console.log('Seller authenticated through UI');
    await seller.getByRole('button', { name: 'Додати підписку' }).click();
    await seller.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await seller.getByRole('option', { name: /› Мед$/ }).click(); console.log('Subscription category selected');
    await seller.getByRole('combobox', { name: 'Країна, область або населений пункт' }).fill('Рівне');
    await seller.getByRole('option', { name: /^місто, Рівне, .*Рівненська область/ }).click(); console.log('Rivne selected');
    await seller.getByRole('checkbox', { name: 'Враховувати передмістя' }).check();
    await expect(seller.getByRole('slider', { name: 'Відстань за межами міста' })).toHaveValue('10');
    await seller.getByRole('combobox', { name: 'Одиниця', exact: true }).selectOption('kg');
    await seller.getByLabel('Кількість від', { exact: true }).fill('10');
    await seller.getByLabel('Кількість до', { exact: true }).fill('50');
    await seller.getByLabel('Прийнятна ціна від, за одиницю').fill('170');
    await seller.getByLabel('Прийнятна ціна до, за одиницю').fill('190');
    await seller.getByRole('combobox', { name: 'Валюта', exact: true }).selectOption('UAH');
    await seller.getByRole('checkbox', { name: /Самовивіз/ }).uncheck();
    const savedResponse = seller.waitForResponse(r => new URL(r.url()).pathname === '/api/demand-subscriptions' && r.request().method() === 'POST');
    await seller.getByRole('button', { name: 'Зберегти підписку' }).click();
    const saved = await savedResponse;
    expect(saved.status(), await saved.text()).toBe(201);
    subscriptionId = (await saved.json()).subscription.id; console.log('Rivne subscription 10 km saved in real DB');
    await expect(seller.locator('.subscription-card')).toContainText('Передмістя: до 10 км');
    const beforeResponse = seller.waitForResponse(r => new URL(r.url()).pathname === '/api/notifications');
    await seller.goto('/notifications');
    const before = (await (await beforeResponse).json()).unreadCounts.selling;

    await login(buyer, 'Buyer A', '/my/requests/new'); console.log('Buyer authenticated through UI');
    await buyer.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Мед');
    await buyer.getByRole('option', { name: /› Мед$/ }).click();
    await buyer.locator('input[name="title"]').fill(title);
    await buyer.locator('textarea[name="description"]').fill(description);
    await buyer.locator('input[name="quantity"]').fill('12.5');
    await buyer.locator('select[name="unit"]').selectOption('kg');
    await buyer.getByRole('radio', { name: /Можна кількома продавцями/ }).check();
    await buyer.locator('select[name="receiptMethod"]').selectOption('SELLER_DELIVERY');
    await buyer.locator('input[name="deadline"]').fill(deadline);
    await expect(buyer.getByText(cityOnly ? 'Оберіть місце для мапи.' : '✓ Точку для мапи визначено', { exact: true })).toBeVisible();
    await expect(buyer.locator('input[name="minPrice"]')).toHaveValue('');
    await expect(buyer.locator('input[name="maxPrice"]')).toHaveValue('');
    const createdResponse = buyer.waitForResponse(r => new URL(r.url()).pathname === '/api/buy-requests' && r.request().method() === 'POST');
    await buyer.getByRole('button', { name: 'Опублікувати запит' }).click();
    const created = await createdResponse;
    expect(created.status(), await created.text()).toBe(201);
    requestId = (await created.json()).buyRequest.id; console.log('Unpriced Request created through UI');

    const alertResponse = seller.waitForResponse(r => new URL(r.url()).pathname === '/api/notifications');
    await seller.reload();
    const alerts = await (await alertResponse).json();
    expect(alerts.unreadCounts.selling).toBe(before + 1);
    const notification = alerts.notifications.find((n:{buyRequestId:string})=>n.buyRequestId===requestId);
    expect(notification).toMatchObject({context:'selling',readAt:null,buyRequestPreview:{title,quantity:12.5,unit:'kg',minPrice:null,maxPrice:null,receiptMethod:'SELLER_DELIVERY',publicPlace:'Рівне, Рівненська область'}});
    expect(JSON.stringify(notification)).not.toMatch(/latitude|longitude|settlementCode|delivery_address/);
    await seller.getByRole('tab', { name: /^Продаж/ }).click();
    await expect(seller.getByRole('tab', { name: new RegExp(`^Продаж ${before+1}$`) })).toBeVisible();
    const row = seller.locator('.notification-row').filter({ hasText: title });
    for (const width of [1440,1024,768,390,320]) {
      await seller.setViewportSize({ width, height: 900 });
      await expect(row.locator('.notification-event-title')).toHaveText(notification.title);
      await expect(row.locator('.notification-event-body')).toHaveText(notification.body);
      await expect(row.getByText(title, { exact: true })).toBeVisible();
      await expect(row.getByText('12.5 кг', { exact: true })).toBeVisible();
      await expect(row.getByText('Доставка продавцем', { exact: true })).toBeVisible();
      await expect(row.getByText('Не вказано', { exact: true })).toBeVisible();
      await expect(row.getByText('Рівне, Рівненська область', { exact: true })).toBeVisible();
      await expect(row.getByText(deadlineLabel, { exact: true })).toBeVisible();
      await expect(row.locator('small')).toContainText('Непрочитано');
      await noOverflow(seller);
      if(width<1024){await row.getByText('Короткий опис',{exact:true}).click();await expect(row.locator('.demand-notification-description p')).toBeVisible();await row.getByText('Короткий опис',{exact:true}).click();}
      await seller.screenshot({ path: testInfo.outputPath(`live-notification-${width}.png`), fullPage: true });
    }
    await row.getByRole('button', { name: 'Переглянути', exact: true }).click();
    await expect(seller).toHaveURL(new RegExp('/buy-requests/'+requestId+'$'));
    await expect(seller.getByRole('heading', { name: title, exact: true })).toBeVisible();
    const readResponse = seller.waitForResponse(r=>new URL(r.url()).pathname==='/api/notifications');
    await seller.goto('/notifications');
    const read = await (await readResponse).json();
    expect(read.unreadCounts.selling).toBe(before);
    expect(read.notifications.find((n:{id:string})=>n.id===notification.id).readAt).not.toBeNull();
    // Existing matches must open the real map/list with the saved subscription.
    await seller.setViewportSize({ width: 1440, height: 900 });
    await seller.goto('/settings/demand-subscriptions');
    const card = seller.locator('.subscription-card');
    await expect(card.getByRole('link', { name: 'Збігів: 1', exact: true })).toBeVisible();
    const matchesResponse = seller.waitForResponse(r => new URL(r.url()).pathname === `/api/demand-subscriptions/${subscriptionId}/matches` && r.status() === 200).then(response => response.json());
    await card.getByRole('link', { name: 'Збігів: 1', exact: true }).click();
    const matches = await matchesResponse;
    expect(matches.count).toBe(1);
    if(cityOnly) {
      expect(matches.markers).toHaveLength(0);
      expect(matches.unmappedRequests).toMatchObject([{id:requestId,settlement:{code:'UA56060470010041018'}}]);
    } else {
      expect(matches.markers.map((m:{id:string})=>m.id)).toEqual([requestId]);
      expect(matches.markers[0]).toMatchObject({approximate:true,latitude:50.62,longitude:26.25});
      expect(matches.markers[0]).not.toHaveProperty('publicAddress');
    }
    await expect(seller).toHaveURL(new RegExp(`/discover\\?demandSubscription=${subscriptionId}$`));
    for (const width of [1440,1024,768,390,320]) {
      await seller.setViewportSize({ width, height: 900 });
      if(width!==1440)await seller.reload();
      await expect(seller.locator('.map-listing-result')).toContainText(title, {timeout:45000});
      const mapMarker = seller.locator('.map-canvas .map-adaptive-wrap');
      await expect(mapMarker).toHaveCount(1);
      await seller.locator('.map-canvas').scrollIntoViewIfNeeded();
      await expect(mapMarker).toBeVisible();
      if(cityOnly)await expect(seller.locator('.map-listing-result')).toContainText('Орієнтовно в населеному пункті');
      const mapBox = (await seller.locator('.map-canvas').boundingBox())!;
      const markerBox = (await mapMarker.boundingBox())!;
      expect(markerBox.x).toBeGreaterThanOrEqual(mapBox.x);
      expect(markerBox.x + markerBox.width).toBeLessThanOrEqual(mapBox.x + mapBox.width);
      expect(markerBox.y).toBeGreaterThanOrEqual(mapBox.y);
      expect(markerBox.y + markerBox.height).toBeLessThanOrEqual(mapBox.y + mapBox.height);
      await noOverflow(seller);
      await seller.screenshot({ path: testInfo.outputPath(`live-subscription-matches-${width}.png`), fullPage: true });
    }
    if (!cityOnly) {
      // Actual offer/rejection actions use authenticated browser UI, without API fixtures.
      await seller.setViewportSize({ width: 1440, height: 900 });
      await seller.goto(`/buy-requests/${requestId}`);
      await seller.getByRole('button', { name: 'Запропонувати товар', exact: true }).click();
      await seller.locator('.offer-form input[name="quantity"]').fill('12.5');
      await seller.locator('.offer-form input[name="price"]').fill('180');
      await seller.locator('.offer-form input[name="delivery"]').fill('Доставка продавцем');
      const offeredResponse = seller.waitForResponse(r => new URL(r.url()).pathname === `/api/buy-requests/${requestId}/offers` && r.request().method() === 'POST');
      await seller.locator('.offer-form').getByRole('button', { name: 'Запропонувати', exact: true }).click();
      const offered = await offeredResponse;
      expect(offered.status(), await offered.text()).toBe(201);
      const offerId = (await offered.json()).offer.id;
      await buyer.goto('/notifications');
      await buyer.getByRole('tab', { name: /^Купівля/ }).click();
      const newOffer = buyer.locator('.notification-row').filter({ hasText: 'Нова пропозиція' });
      await expect(newOffer.locator('.notification-event-title')).toHaveText('Нова пропозиція');
      await expect(newOffer.locator('.notification-event-body')).toHaveText('Продавець відповів на ваш запит');
      await newOffer.getByRole('button', { name: 'Переглянути', exact: true }).click();
      await expect(buyer).toHaveURL(new RegExp(`/buy-requests/${requestId}$`));
      await buyer.locator('.deal-offer').getByText('Детальніше та інші дії', { exact: true }).click();
      await buyer.getByRole('button', { name: 'Відхилити пропозицію', exact: true }).click();
      const rejectedResponse = buyer.waitForResponse(r => new URL(r.url()).pathname === `/api/offers/${offerId}/reject` && r.request().method() === 'POST');
      await buyer.getByRole('dialog').getByRole('button', { name: 'Відхилити', exact: true }).click();
      expect((await rejectedResponse).status()).toBe(204);
      const sellerAlertsResponse = seller.waitForResponse(r => new URL(r.url()).pathname === '/api/notifications');
      await seller.goto('/notifications');
      const sellerAlerts = await (await sellerAlertsResponse).json();
      const rejection = sellerAlerts.notifications.find((n: { title: string; buyRequestId: string }) => n.title === 'Пропозицію відхилено' && n.buyRequestId === requestId);
      expect(rejection).toMatchObject({ body: 'Покупець відхилив вашу пропозицію', context: 'selling', buyRequestPreview: { title } });
      expect(sellerAlerts.notifications.filter((n: { title: string; buyRequestId: string }) => n.title === rejection.title && n.buyRequestId === requestId)).toHaveLength(1);
      await seller.getByRole('tab', { name: /^Продаж/ }).click();
      const rejectedRow = seller.locator('.notification-row').filter({ hasText: rejection.title });
      for (const width of [1440, 1024, 768, 390, 320]) {
        await seller.setViewportSize({ width, height: 900 });
        await expect(rejectedRow.locator('.notification-event-title')).toHaveText(rejection.title);
        await expect(rejectedRow.locator('.notification-event-title')).toBeVisible();
        await expect(rejectedRow.locator('.notification-event-body')).toHaveText(rejection.body);
        await expect(rejectedRow.locator('.notification-event-body')).toBeVisible();
        await expect(rejectedRow.locator('.notification-request-preview > strong')).toHaveText(title);
        await noOverflow(seller);
        await rejectedRow.scrollIntoViewIfNeeded();
        await seller.screenshot({ path: testInfo.outputPath(`live-rejected-offer-${width}.png`), fullPage: true });
      }
      await rejectedRow.getByRole('button', { name: 'Переглянути', exact: true }).click();
      await expect(seller).toHaveURL(new RegExp(`/buy-requests/${requestId}$`));
      await expect(seller.getByRole('heading', { name: title, exact: true })).toBeVisible();
      const rereadResponse = seller.waitForResponse(r => new URL(r.url()).pathname === '/api/notifications');
      await seller.goto('/notifications');
      const reread = await (await rereadResponse).json();
      expect(reread.unreadCounts.selling).toBe(sellerAlerts.unreadCounts.selling - 1);
      expect(reread.notifications.find((n: { id: string }) => n.id === rejection.id).readAt).not.toBeNull();
      console.log('Real UI offer rejection preserves event title/body, supplementary preview and Request navigation');
    }
    await testInfo.attach('real-flow-result',{body:Buffer.from(JSON.stringify({subscriptionId,requestId,notificationId:notification.id,unreadBefore:before,unreadAfter:before+1,readAfterOpen:read.unreadCounts.selling,mapCount:matches.count,markerRequestId:requestId,cityOnly,viewports:[1440,1024,768,390,320]})),contentType:'application/json'});
  } finally {
    await Promise.allSettled([sellerContext.close(), buyerContext.close()]);
    // Remove only this run's rows from the validated isolated database.
    const db = new Client({connectionString:process.env.DATABASE_URL}); await db.connect();
    try {
      if(requestId){await db.query('DELETE FROM notifications WHERE buy_request_id=$1',[requestId]);await db.query('DELETE FROM buy_requests WHERE id=$1',[requestId]);}
      if(subscriptionId)await db.query('DELETE FROM demand_subscriptions WHERE id=$1',[subscriptionId]);
      await db.query('UPDATE users SET map_location_mode=$1,public_latitude=$2,public_longitude=$3,settlement_code=$4,location_display=$5 WHERE id=$6',[profileSnapshot.map_location_mode,profileSnapshot.public_latitude,profileSnapshot.public_longitude,profileSnapshot.settlement_code,profileSnapshot.location_display,profileSnapshot.id]);
    } finally {await db.end();}
  }
});
}
