import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';
import pg from 'pg';

const qaAccount = async (section: string) => {
  const text = (await readFile('docs/TEST_ACCOUNTS.local.md', 'utf8')).replaceAll('\r\n', '\n');
  const block = text.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  const username = block?.match(/Username:\s*([^\r\n]+)/)?.[1].trim();
  const password = block?.match(/Password:\s*([^\r\n]+)/)?.[1].trim();
  if (!username || !password) throw new Error(`Missing documented QA account: ${section}`);
  return { username, password };
};

test('Step 15 correction: paged search, filters and map at desktop and mobile widths', async ({ browser }) => {
  test.setTimeout(300_000);
  const databaseUrl = new URL(process.env.DATABASE_URL ?? '');
  if (!['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) throw new Error('Use only the local QA database');
  const db = new pg.Client({ connectionString: process.env.DATABASE_URL });
  let dbConnected = false;
  const stamp = `Step15Corr${Date.now()}`;
  const context = await browser.newContext({ baseURL: process.env.E2E_BASE_URL ?? 'http://127.0.0.1:5173', viewport: { width: 1440, height: 900 } });
  try {
    await db.connect();
    dbConnected = true;
    const seller = await qaAccount('Seller A');
    const buyer = await qaAccount('Buyer A');
    const owner = (await db.query('SELECT id FROM users WHERE username=$1', [seller.username])).rows[0];
    const category = (await db.query('SELECT id FROM categories WHERE name=$1', ['Велосипеди'])).rows[0];
    if (!owner || !category) throw new Error('QA owner or bicycle category missing');
    const created = await db.query(`INSERT INTO products
      (owner_id,category_id,title,description,quantity,unit,price,currency,delivery_mode,geo_zone,settlement_code,latitude,longitude,status,pickup_address)
      SELECT $1,$2,'Велосипед ' || $3 || ' ' || n,'Червоний дитячий',1,'piece',100,'UAH','pickup','Рівне','UA56060470010041018',50.6199,26.2516,'active',$3
      FROM generate_series(1,10) n RETURNING id,title`, [owner.id, category.id, stamp]);
    expect(created.rowCount).toBe(10);
    console.log('Step15 browser: fixtures created');

    const page = await context.newPage();
    await page.goto('/auth/login?return=%2Fproducts');
    await page.locator('input[name="username"]').fill(buyer.username);
    await page.locator('input[name="password"]').fill(buyer.password);
    await page.getByRole('button', { name: 'Увійти в акаунт' }).click();
    await expect(page).toHaveURL(/\/products$/);
    console.log('Step15 browser: logged in');

    const phrase = `червоний дитячий велосипед ${stamp}`;
    await page.getByRole('searchbox', { name: 'Пошук товару або продавця' }).fill(phrase);
    await page.getByRole('button', { name: 'Пошук', exact: true }).click();
    await expect(page.locator('.product-grid .product-card')).toHaveCount(8, { timeout: 30000 });
    console.log('Step15 browser: first search loaded');
    const picker = page.getByRole('combobox', { name: 'Пошук або вибір категорії' });
    await picker.fill('Велосипеди');
    await page.getByRole('option').filter({ has: page.locator('span', { hasText: /› Велосипеди$/ }) }).first().click();
    const place = page.getByRole('combobox', { name: 'Населений пункт' });
    await place.click();
    await page.getByRole('option', { name: 'Рівненська область', exact: true }).click();
    await page.getByRole('button', { name: 'Вся область' }).click();
    const filtered = page.waitForResponse(response => {
      const url = new URL(response.url());
      return url.pathname === '/api/products' && url.searchParams.get('q') === phrase && url.searchParams.get('categoryId') === category.id && url.searchParams.get('region') === 'Рівненська область';
    });
    await page.getByRole('button', { name: 'Пошук', exact: true }).click();
    expect((await filtered).status()).toBe(200);
    await expect(page.locator('.product-grid .product-card')).toHaveCount(8, { timeout: 30000 });
    console.log('Step15 browser: filters loaded');
    await expect(page.locator('.pagination')).toContainText('1 / 2');
    const firstTitles = await page.locator('.product-grid h3').allTextContents();
    await page.setViewportSize({ width: 390, height: 850 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.locator('.pagination').getByRole('button', { name: '→' }).click();
    await expect(page.locator('.pagination')).toContainText('2 / 2', { timeout: 30000 });
    await expect(page.locator('.product-grid .product-card')).toHaveCount(2);
    const secondTitles = await page.locator('.product-grid h3').allTextContents();
    expect(new Set([...firstTitles, ...secondTitles]).size).toBe(10);
    console.log('Step15 browser: pagination loaded');

    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto('/map');
    console.log('Step15 browser: map opened');
    await page.getByRole('searchbox', { name: /Пошук товару/ }).fill(stamp);
    const mapPlace = page.getByRole('combobox', { name: 'Населений пункт' });
    await mapPlace.click();
    await page.getByRole('option', { name: 'Рівненська область', exact: true }).click();
    await page.getByRole('button', { name: 'Вся область' }).click();
    await page.getByRole('button', { name: 'Знайти', exact: true }).click();
    await expect(page.getByText('Знайдено: 10')).toBeVisible({ timeout: 30000 });
    await expect(page.getByRole('heading', { name: '10 товарів' })).toBeVisible();
    console.log(JSON.stringify({ correctionBrowserQA: 'passed', viewports: [1440, 390], firstPage: firstTitles.length, secondPage: secondTitles.length }));
  } finally {
    await context.close().catch(() => undefined);
    if (dbConnected) {
      await db.query('DELETE FROM products WHERE pickup_address=$1 AND owner_id=(SELECT id FROM users WHERE username=$2)', [stamp, (await qaAccount('Seller A')).username]);
      await db.end();
    }
  }
});
