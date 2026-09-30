import { expect, test } from '@playwright/test';

test('unread UI uses one list for navigation, successful read, retry and deep link', async ({ page }) => {
  test.setTimeout(240_000);
  const conversations = [
    { id: 'read', title: 'Прочитаний чат', unreadCount: 0 },
    { id: 'incoming', title: 'Нові повідомлення', unreadCount: 2 },
    { id: 'other', title: 'Інший непрочитаний чат', unreadCount: 1 },
  ].map(c => ({ ...c, type: 'direct', otherUsername: 'Співрозмовник', userRole: 'buying', lastMessage: 'Тестове повідомлення', lastMessageAt: new Date().toISOString(), status: 'active' }));
  let failRead = true;
  const reads: string[] = [];
  let notificationReads = 0;
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: unknown = {};
    if (path === '/api/auth/me') json = { user: { id: 'viewer', username: 'QA' } };
    else if (path === '/api/categories') json = { categories: [] };
    else if (path === '/api/profile/me') json = { profile: { id: 'viewer', avatarUrl: null } };
    else if (path.startsWith('/api/products')) json = { products: [], pagination: { page: 1, pages: 1 } };
    else if (path === '/api/notifications') json = { notifications: [{ id: 'notification', readAt: null }] };
    else if (path.startsWith('/api/notifications') && method === 'PATCH') notificationReads++;
    else if (path === '/api/conversations') json = { conversations };
    else if (path.endsWith('/context')) json = { context: null, proposals: [] };
    else if (path.endsWith('/messages')) json = { messages: [{ id: 'm', senderId: 'other', body: 'Завантажене повідомлення', createdAt: new Date().toISOString() }] };
    else if (path.endsWith('/read')) {
      const id = path.split('/')[3];
      reads.push(id);
      if (id === 'incoming' && failRead) return route.fulfill({ status: 503, json: {} });
      const conversation = conversations.find(c => c.id === id);
      if (conversation) conversation.unreadCount = 0;
      json = { readAt: new Date().toISOString() };
    }
    await route.fulfill({ json });
  });
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/messages', { waitUntil: 'domcontentloaded' });
  const sidebar = page.locator('.sidebar-primary .message-unread-count');
  await expect(sidebar).toHaveText('3');
  await expect(page.locator('.conversation-row.unread')).toHaveCount(2);
  await page.getByRole('button', { name: /Відкрити чат: Нові повідомлення/ }).click();
  await expect(page.getByText('Не вдалося оновити стан прочитання. Повторимо автоматично.')).toBeVisible();
  await expect(page.locator('.deal-chat-history')).toContainText('Завантажене повідомлення');
  await expect(sidebar).toHaveText('3');
  failRead = false;
  await expect(sidebar).toHaveText('1', { timeout: 15000 });
  await expect(page.locator('.conversation-row.unread')).toHaveCount(1);
  expect(reads).toContain('incoming');
  await page.goto('/messages/other');
  await expect(sidebar).toHaveCount(0);
  await expect(page.locator('.conversation-row.unread')).toHaveCount(0);
  expect(reads).toContain('other');
  expect(notificationReads).toBe(0);
  await expect(page.locator('.sidebar-notification-count').first()).toHaveText('1');
  conversations[1].unreadCount = 120;
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/messages', { waitUntil: 'domcontentloaded' });
    const badge = page.locator(width <= 700 ? '.mobile-nav .message-unread-count' : '.sidebar-primary .message-unread-count');
    await expect(badge).toHaveText('99+');
    await expect(badge).toHaveAttribute('aria-label', 'Непрочитані повідомлення: 120');
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBeTruthy();
    await page.screenshot({ path: `test-results/messages-unread-${width}.png`, fullPage: true });
  }
});
