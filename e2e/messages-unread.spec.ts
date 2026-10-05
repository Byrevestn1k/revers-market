import { expect, test } from '@playwright/test';
import { existsSync, readFileSync } from 'node:fs';

// Use the existing local fixture; never embed account credentials in source.
const fixture = existsSync('docs/TEST_ACCOUNTS.local.md') ? readFileSync('docs/TEST_ACCOUNTS.local.md', 'utf8').replace(/\r\n/g, '\n') : '';
test.skip(!fixture, 'Existing local QA accounts are required.');
const account = (section: string) => {
  const text = fixture.split(`## ${section}\n`)[1]?.split('\n## ')[0];
  if (!text) throw new Error(`Missing QA account: ${section}`);
  return { username: text.match(/Username: (.+)/)![1].trim(), password: text.match(/Password: (.+)/)![1].trim() };
};
const ids = ['823b3103-2b2c-4bbd-aadb-5b70d7968656', 'd84b1baa-74de-48bd-9e87-f14997451404'];

test('real unread messages synchronize list, navigation, direct links and persisted read state', async ({ browser }) => {
  const contexts = await Promise.all(['Buyer A', 'Seller A', 'Seller B'].map(async section => {
    const context = await browser.newContext({ baseURL: 'http://127.0.0.1:5173' });
    const response = await context.request.post('/api/auth/login', { data: account(section) });
    expect(response.ok()).toBeTruthy();
    return context;
  }));
  const [buyer, sellerA, sellerB] = contexts;
  const list = async (context = buyer) => (await (await context.request.get('/api/conversations')).json()).conversations;
  const total = async () => (await list()).filter((c: any) => !c.archivedAt).reduce((sum: number, c: any) => sum + c.unreadCount, 0);
  const notificationState = async () => (await (await buyer.request.get('/api/notifications')).json()).notifications.map((n: any) => [n.id, n.readAt]);
  const stamp = Date.now();
  try {
    for (const id of ids) expect((await buyer.request.patch(`/api/conversations/${id}/read`)).ok()).toBeTruthy();
    for (const [sender, id] of [[sellerA, ids[0]], [sellerB, ids[1]]] as const) {
      const before = (await list(sender)).find((c: any) => c.id === id).unreadCount;
      expect((await sender.request.post(`/api/conversations/${id}/messages`, { data: { body: `STEP 2 QA ${stamp}` } })).ok()).toBeTruthy();
      expect((await list(sender)).find((c: any) => c.id === id).unreadCount).toBe(before);
    }
    const notifications = await notificationState();
    const initialTotal = await total();
    const page = await buyer.newPage();
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/messages');
    const mobileBadge = page.locator('.mobile-nav .message-unread-count');
    await expect(mobileBadge).toHaveAttribute('aria-label', `Непрочитані повідомлення: ${initialTotal}`);
    await expect(page.locator('.conversation-row.unread')).toHaveCount((await list()).filter((c: any) => !c.archivedAt && c.unreadCount > 0).length);
    await expect(page.locator('.messages-dialog .chat-input')).toHaveCount(0);
    let allowRead = false;
    await page.route(`**/api/conversations/${ids[0]}/read`, async route => allowRead ? route.continue() : route.fulfill({ status: 503, json: { message: 'QA read failure' } }));
    await page.locator('.conversation-row')
      .filter({ hasText: account('Seller A').username })
      .filter({ hasText: `STEP 2 QA ${stamp}` })
      .click();
    await expect(page.locator('.deal-chat-history')).toContainText(`STEP 2 QA ${stamp}`);
    await expect(page.getByText('Не вдалося оновити стан прочитання. Повторимо автоматично.')).toBeVisible();
    expect((await list()).find((c: any) => c.id === ids[0]).unreadCount).toBe(1);
    allowRead = true;
    await expect(mobileBadge).toHaveAttribute('aria-label', `Непрочитані повідомлення: ${initialTotal - 1}`, { timeout: 15000 });
    expect((await list()).find((c: any) => c.id === ids[1]).unreadCount).toBe(1);
    await page.getByRole('button', { name: 'Повернутися до списку чатів', exact: true }).click();
    await expect(page).toHaveURL(/\/messages$/);
    await page.goto(`/messages/${ids[1]}`);
    await expect.poll(total).toBe(initialTotal - 2);
    await page.getByRole('textbox', { name: 'Повідомлення', exact: true }).fill(`STEP 2 own QA ${stamp}`);
    await page.getByRole('button', { name: 'Надіслати', exact: true }).click();
    await expect(page.locator('.deal-chat-history')).toContainText(`STEP 2 own QA ${stamp}`);
    expect(await total()).toBe(initialTotal - 2);
    await page.reload();
    await expect.poll(async () => (await list()).find((c: any) => c.id === ids[1]).unreadCount).toBe(0);
    expect(await notificationState()).toEqual(notifications);
    for (const width of [1440, 1280, 1024, 768, 390, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/messages');
      await expect(page.getByRole('heading', { name: 'Мої повідомлення' })).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    }
  } finally {
    await Promise.all(contexts.map(context => context.close()));
  }
});
