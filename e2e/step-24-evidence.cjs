const { chromium, request } = require('playwright');
const { Client } = require('pg');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const crypto = require('node:crypto');

// This script intentionally refuses any database except the dedicated disposable instance.
const database = process.env.DATABASE_URL;
const dbUrl = new URL(database || 'invalid:');
if (dbUrl.hostname !== '127.0.0.1' || dbUrl.port !== '55439' || dbUrl.pathname !== '/step24test' || dbUrl.username !== 'step24test') throw Error('Refusing non-isolated database');
const baseURL = 'http://127.0.0.1:5179';
const output = 'docs/qa/step-24';
const password = crypto.randomBytes(16).toString('hex') + 'Aa1!';
const stamp = Date.now();
const query = `Пшениця QA24 ${stamp}`;
const buyer = `qa24buyer${stamp}`;
const seller = `qa24seller${stamp}`;
const report = [];
const check = (name, condition) => { assert.ok(condition, name); report.push({ assertion: name, result: 'PASS' }); };

async function main() {
  fs.mkdirSync(output, { recursive: true });
  const db = new Client({ connectionString: database });
  await db.connect();
  const identity = (await db.query('select current_database() as db, current_user as usr')).rows[0];
  assert.deepEqual(identity, { db: 'step24test', usr: 'step24test' });
  const api = await request.newContext({ baseURL });
  for (const [index, username] of [buyer, seller].entries()) {
    const response = await api.post('/api/auth/register', { data: { username, email: `${username}@example.test`, countryCode: 'UA', phone: `+38050123${String(stamp + index).slice(-4)}`, password, passwordConfirmation: password } });
    assert.equal(response.status(), 201, await response.text());
    await db.query("UPDATE users SET map_location_mode='pin', public_latitude=50.6199, public_longitude=26.2516, settlement_code='UA56060470010041018', location_display='Рівне' WHERE username=$1", [username]);
  }
  assert.equal((await api.post('/api/auth/login', { data: { username: seller, password } })).status(), 200);
  const categories = (await (await api.get('/api/categories')).json()).categories;
  const category = categories.find(item => item.code === 'grains');
  assert.ok(category);
  for (let i = 0; i < 16; i++) {
    const result = await api.post('/api/products', { data: { categoryId: category.id, title: `${query} ${String(i + 1).padStart(2, '0')}`, description: 'Синтетичний товар для QA', quantity: 1, unit: 'kg', price: 100 + i * 13, currency: ['UAH', 'USD', 'EUR', 'PLN'][i % 4], deliveryMode: 'pickup', status: 'active', geoZone: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin' } });
    assert.equal(result.status(), 201, await result.text());
  }
  await api.dispose(); await db.end();
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of [390, 1280]) {
      const context = await browser.newContext({ baseURL, viewport: { width, height: 900 } });
      const page = await context.newPage(); page.setDefaultTimeout(30000);
      const errors = [];
      await page.goto('/auth/login?return=%2Fdiscover');
      await page.getByLabel('Логін, електронна пошта').fill(buyer);
      await page.locator('input[name="password"]').fill(password);
      await page.getByRole('button', { name: /Увійти в акаунт/ }).click();
      await page.waitForURL('**/discover');
      page.on('pageerror', e => errors.push(e.message)); page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
      const dimensions = await page.evaluate(() => ({ innerWidth: window.innerWidth, clientWidth: document.documentElement.clientWidth, scrollWidth: document.documentElement.scrollWidth }));
      check(`${width}: viewport innerWidth`, dimensions.innerWidth === width);
      check(`${width}: no horizontal overflow`, dimensions.scrollWidth <= dimensions.clientWidth);
      report.push({ viewport: { width, height: 900 }, ...dimensions });
      await page.locator('.map-search-main input').fill(query);
      await page.getByLabel('Спосіб отримання').selectOption('SELF_PICKUP');
      await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).fill('Зернові');
      await page.getByRole('button', { name: 'Вибрати категорію Зернові' }).filter({ visible: true }).first().click();
      const city = page.getByLabel('Населений пункт');
      await city.click();
      await city.fill('Рівне');
      await page.getByRole('option', { name: /Рівне/ }).first().click();
      await page.locator('.map-search-controls').getByRole('button', { name: 'Знайти', exact: true }).click();
      const sortedResponse = page.waitForResponse(r => r.url().includes('/api/products/sorted') && r.request().method() === 'POST' && r.ok());
      await page.getByLabel('Сортувати:').selectOption('price_asc');
      const sortedData = await (await sortedResponse).json();
      await page.getByLabel('Показувати ціни:').selectOption('USD');
      const cards = page.locator('.market-results .product-card');
      await cards.first().waitFor({ timeout: 60000 });
      await page.waitForFunction(() => document.querySelector('.market-results .product-card')?.textContent?.includes('≈'), null, { timeout: 30000 });
      const first = cards.first(); const title = await first.locator('h3').innerText();
      check(`${width}: sorted server order`, JSON.stringify(await cards.locator('h3').allTextContents()) === JSON.stringify(sortedData.products.map(p => p.title)));
      check(`${width}: filtered products`, (await cards.count()) > 0 && title.includes('Пшениця QA24'));
      check(`${width}: original and approximate price`, /UAH|USD|EUR|PLN|\$/.test(await first.innerText()) && (await first.innerText()).includes('≈'));
      const price = sortedData.products[0].price;
      const expected = (Number(price.amount) * Number(sortedData.rateSet.rates[price.currency]) / Number(sortedData.rateSet.rates.USD)).toFixed(2).replace('.', ',');
      check(`${width}: converted amount`, (await first.innerText()).includes(expected));
      check(`${width}: rate date`, await page.getByText(/Курс НБУ від/).isVisible());
      await first.getByRole('button', { name: 'Додати в обране' }).click();
      await first.getByRole('button', { name: 'Прибрати з обраного' }).waitFor();
      await page.screenshot({ path: `${output}/search-${width}.png`, fullPage: true });
      await page.goto('/favorites');
      const favorite = page.locator('.favorites-view .product-card').filter({ hasText: title }); await favorite.waitFor();
      check(`${width}: favorite persisted`, await favorite.isVisible());
      await page.screenshot({ path: `${output}/favorites-${width}.png`, fullPage: true });
      await page.goBack(); await cards.filter({ hasText: title }).waitFor();
      await cards.filter({ hasText: title }).locator('.listing-card-open').click(); await page.waitForURL(/\/products\//);
      check(`${width}: details price`, (await page.locator('.detail-price').innerText()).length > 0 && await page.getByText(/Перераховано за офіційним курсом НБУ/).isVisible());
      await page.goBack(); const restored = cards.filter({ hasText: title }); await restored.waitFor();
      check(`${width}: query retained`, await page.locator('.map-search-main input').inputValue() === query);
      check(`${width}: category retained`, (await page.getByRole('combobox', { name: 'Пошук або вибір категорії' }).inputValue()).includes('Зернові'));
      check(`${width}: city retained`, (await city.inputValue()).includes('Рівне'));
      check(`${width}: delivery retained`, await page.getByLabel('Спосіб отримання').inputValue() === 'SELF_PICKUP');
      check(`${width}: sorting retained`, await page.getByLabel('Сортувати:').inputValue() === 'price_asc');
      check(`${width}: currency retained`, await page.getByLabel('Показувати ціни:').inputValue() === 'USD');
      check(`${width}: favorite retained after details`, await restored.getByRole('button', { name: 'Прибрати з обраного' }).isVisible());
      await restored.getByRole('button', { name: 'Прибрати з обраного' }).click();
      await restored.getByRole('button', { name: 'Додати в обране' }).waitFor();
      check(`${width}: favorite removed`, await restored.getByRole('button', { name: 'Додати в обране' }).isVisible());
      const pageOne = await cards.locator('h3').allTextContents();
      const next = page.waitForResponse(r => r.url().includes('/api/products/sorted') && r.request().method() === 'POST' && r.ok() && r.request().postDataJSON().page === 2);
      await page.locator('.market-results .pagination button').last().click();
      const pageTwoData = await (await next).json();
      await page.waitForFunction(title => document.querySelector('.market-results .product-card h3')?.textContent === title, pageTwoData.products[0].title);
      const pageTwo = await cards.locator('h3').allTextContents();
      check(`${width}: pagination server order and no duplicates`, pageTwo.length > 0 && pageTwo.every(title => !pageOne.includes(title)) && JSON.stringify(pageTwo) === JSON.stringify(pageTwoData.products.map(p => p.title)) && pageTwoData.rateSet.id === sortedData.rateSet.id);
      report.push({ width, consoleErrors: errors });
      check(`${width}: no console errors`, errors.length === 0);
      await context.close();
    }
  } finally { await browser.close(); fs.writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2)); }
}
main().catch(error => { report.push({ result: 'FAIL', error: error.message }); fs.writeFileSync(`${output}/results.json`, JSON.stringify(report, null, 2)); console.error(error); process.exitCode = 1; });
