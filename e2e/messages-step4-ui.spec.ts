import { expect, test } from '@playwright/test';

test('chat UX filters, dates, statuses, saved state and trash use one conversation contract', async ({ page }) => {
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const conversations: any[] = [
    { id: 'offer-buy', type: 'offer', title: 'Купити соняшник', buyRequestId: 'request-1', otherUserId: 'seller', otherUsername: 'Продавець', userRole: 'buying', price: 120, currency: 'UAH', lastMessage: 'Домовимось', lastMessageAt: now.toISOString(), unreadCount: 2, status: 'submitted', pinnedAt: null, archivedAt: null },
    { id: 'offer-sell', type: 'offer', title: 'Продати пшеницю', buyRequestId: 'request-2', otherUserId: 'buyer', otherUsername: 'Покупець', userRole: 'selling', price: 90, currency: 'UAH', lastMessage: 'Дякую', lastMessageAt: yesterday.toISOString(), unreadCount: 0, status: 'submitted', pinnedAt: null, archivedAt: null },
    { id: 'direct', type: 'direct', title: 'Яблука', productId: 'product-1', otherUserId: 'buyer-2', otherUsername: 'Покупець товару', userRole: 'selling', lastMessage: 'Чи актуально?', lastMessageAt: yesterday.toISOString(), unreadCount: 1, status: 'active', pinnedAt: null, archivedAt: null },
  ];
  const messages = [
    { id: 'old', kind: 'text', senderId: 'viewer', senderUsername: 'Я', body: 'Надіслане вчора', createdAt: yesterday.toISOString() },
    { id: 'new', kind: 'text', senderId: 'seller', senderUsername: 'Продавець', body: 'Нове повідомлення', createdAt: now.toISOString() },
  ];
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname;
    const method = route.request().method();
    let json: any = {};
    if (path === '/api/auth/me') json = { user: { id: 'viewer', username: 'QA' } };
    else if (path === '/api/categories') json = { categories: [] };
    else if (path === '/api/profile/me') json = { profile: { id: 'viewer', avatarUrl: null } };
    else if (path === '/api/products') json = { products: [], pagination: { page: 1, pages: 1 } };
    else if (path === '/api/notifications') json = { notifications: [], unreadCounts: { total: 0, buying: 0, selling: 0 } };
    else if (path === '/api/conversations') json = { conversations };
    else if (path.endsWith('/pinned') && method === 'PATCH') {
      const item = conversations.find(value => value.id === path.split('/')[3]);
      item.pinnedAt = (route.request().postDataJSON() as any).pinned ? now.toISOString() : null;
      json = { pinnedAt: item.pinnedAt };
    } else if (path.endsWith('/archived') && method === 'PATCH') {
      const item = conversations.find(value => value.id === path.split('/')[3]);
      item.archivedAt = (route.request().postDataJSON() as any).archived ? now.toISOString() : null;
      json = { archivedAt: item.archivedAt };
    } else if (path.endsWith('/personal') && method === 'DELETE') {
      const index = conversations.findIndex(value => value.id === path.split('/')[3]);
      conversations.splice(index, 1);
      json = { deletedAt: now.toISOString() };
    } else if (path.endsWith('/pinned') || path.endsWith('/archived')) {
      await route.fulfill({ status: 405, json: { error: 'Method not allowed' } });
      return;
    } else if (path.endsWith('/block')) json = method === 'GET' ? { blockedByMe: false, blockedByOther: false } : {};
    else if (path.endsWith('/context')) json = { context: { requestId: 'request-1', title: 'Купити соняшник', buyerId: 'viewer', sellerId: 'seller', unit: 'kg', currency: 'UAH', price: 120, offeredQuantity: 10, quantity: 10, remaining: 10, delivery: 'Самовивіз', deliveryPrice: 0, fulfillmentMode: 'single_seller', available: true }, proposals: [] };
    else if (path.endsWith('/messages') && method === 'GET') json = { messages, counterpartLastReadAt: now.toISOString() };
    else if (path.endsWith('/messages')) json = { message: { id: 'sent', createdAt: now.toISOString() } };
    else if (path.endsWith('/read')) json = { readAt: now.toISOString() };
    await route.fulfill({ json });
  });

  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto('/messages');
  await expect(page.getByText('Купити соняшник').first()).toBeVisible();
  await expect(page.locator('.message-scope-tabs button')).toHaveCount(4);
  await expect(page.locator('.saved-utility')).toBeVisible();
  await expect(page.locator('.trash-utility')).toHaveClass(/trash-utility/);
  await page.getByRole('button', { name: /Покупки 1/ }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await expect(page.locator('.conversation-row')).toContainText('Купити соняшник');
  await page.getByRole('button', { name: /Продажі 2/ }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(2);

  await page.getByRole('button', { name: /Покупки 1/ }).click();
  await page.locator('.conversation-row').click();
  await expect(page.getByText('Сьогодні').last()).toBeVisible();
  await expect(page.getByText('Вчора').last()).toBeVisible();
  await expect(page.locator('.chat-message-status.read')).toHaveAttribute('aria-label', 'Прочитано');
  await expect(page.locator('.chat-context-actions a')).toHaveAttribute('href', '/buy-requests/request-1');

  const buyCardActions = page.locator('.conversation-row').filter({ hasText: 'Купити соняшник' }).getByRole('button', { name: 'Дії з чатом' });
  const sellCardActions = page.locator('.conversation-row').filter({ hasText: 'Продати пшеницю' }).getByRole('button', { name: 'Дії з чатом' });
  const headerActions = page.locator('.chat-context-actions').getByRole('button', { name: 'Дії з чатом' });
  const buyCardMenu = page.locator('.conversation-row').filter({ hasText: 'Купити соняшник' }).locator('.chat-actions-menu');
  const sellCardMenu = page.locator('.conversation-row').filter({ hasText: 'Продати пшеницю' }).locator('.chat-actions-menu');

  await buyCardActions.click();
  await expect(buyCardMenu).toBeVisible();
  await expect(buyCardMenu.evaluate((menu) => {
    const rect = menu.getBoundingClientRect();
    const elementAtMenuCenter = document.elementFromPoint(rect.left + rect.width / 2, rect.top + Math.min(20, rect.height / 2));
    return Boolean(elementAtMenuCenter && menu.contains(elementAtMenuCenter));
  })).resolves.toBe(true);
  await sellCardActions.click();
  await expect(buyCardMenu).toBeHidden();
  await expect(sellCardMenu).toBeVisible();
  await page.getByRole('heading', { name: 'Мої повідомлення' }).click();
  await expect(sellCardMenu).toBeHidden();
  await sellCardActions.click();
  await page.keyboard.press('Escape');
  await expect(sellCardMenu).toBeHidden();
  await buyCardActions.click();
  await page.getByRole('menuitem', { name: 'Додати в збережене' }).click();
  await expect(buyCardMenu).toBeHidden();

  await page.getByRole('button', { name: 'Збережені' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('соняшник');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('немає такого чату');
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await page.getByLabel('Пошук у повідомленнях').fill('');

  await headerActions.click();
  await expect(page.locator('.chat-context-actions .chat-actions-menu')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.chat-context-actions .chat-actions-menu')).toBeHidden();
  await headerActions.click();
  await page.getByRole('menuitem', { name: 'Перемістити в кошик' }).click();
  await page.getByRole('button', { name: 'Перемістити', exact: true }).click();
  await expect(page.getByRole('button', { name: /Кошик.*Непрочитані повідомлення: 2/ })).toBeVisible();
  await page.getByRole('button', { name: /Кошик.*Непрочитані повідомлення: 2/ }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('Домовимось');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('');
  await page.locator('.conversation-row').click();
  await headerActions.click();
  await page.getByRole('menuitem', { name: 'Відновити з кошика' }).click();
  await page.getByRole('button', { name: 'Збережені' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);

  await headerActions.click();
  await page.getByRole('menuitem', { name: 'Перемістити в кошик' }).click();
  await page.getByRole('button', { name: 'Перемістити', exact: true }).click();
  await page.getByRole('button', { name: /Кошик/ }).click();
  await headerActions.click();
  await page.getByRole('menuitem', { name: 'Видалити остаточно' }).click();
  await expect(page.getByRole('heading', { name: 'Видалити діалог?' })).toBeVisible();
  await page.getByRole('button', { name: 'Видалити', exact: true }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
});
