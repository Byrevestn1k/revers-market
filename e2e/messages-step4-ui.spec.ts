import { expect, test } from '@playwright/test';

test('chat UX filters, dates, statuses, saved state and trash use one conversation contract', async ({ page }) => {
  test.setTimeout(300_000);
  const now = new Date();
  const yesterday = new Date(now); yesterday.setDate(now.getDate() - 1);
  const conversations: any[] = [
    { id: 'offer-buy', type: 'offer', title: 'Купити соняшник', buyRequestId: 'request-1', otherUserId: 'seller', otherUsername: 'Продавець', userRole: 'buying', price: 120, currency: 'UAH', lastMessage: 'Домовимось', lastMessageAt: now.toISOString(), unreadCount: 2, status: 'submitted', pinnedAt: null, archivedAt: null },
    { id: 'offer-sell', type: 'offer', title: 'Продати пшеницю', buyRequestId: 'request-2', otherUserId: 'buyer', otherUsername: 'Покупець', userRole: 'selling', price: 90, currency: 'UAH', lastMessage: 'Дякую', lastMessageAt: yesterday.toISOString(), unreadCount: 0, status: 'submitted', pinnedAt: null, archivedAt: null },
    { id: 'direct', type: 'direct', title: 'Яблука', productId: 'product-1', otherUserId: 'buyer-2', otherUsername: 'Покупець товару', userRole: 'selling', lastMessage: 'Чи актуально?', lastMessageAt: yesterday.toISOString(), unreadCount: 1, status: 'active', pinnedAt: null, archivedAt: null },
  ];
  const messages = [
    { id: 'old', kind: 'text', senderId: 'viewer', senderUsername: 'Я', body: 'Надіслане вчора', createdAt: yesterday.toISOString() },
    { id: 'pending', kind: 'text', senderId: 'viewer', senderUsername: 'Я', body: 'Ще не прочитано', createdAt: now.toISOString() },
    { id: 'new', kind: 'text', senderId: 'seller', senderUsername: 'Продавець', body: 'Нове повідомлення', createdAt: now.toISOString() },
  ];
  const blockTargets: string[] = [];
  const reportTargets: Array<{ targetType: string; targetId: string }> = [];
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
    } else if (path.endsWith('/block')) { if (method !== 'GET') blockTargets.push(`${method} ${path}`); json = method === 'GET' ? { blockedByMe: false, blockedByOther: false } : {}; }
    else if (path === '/api/reports' && method === 'POST') reportTargets.push(route.request().postDataJSON() as { targetType: string; targetId: string });
    else if (path.endsWith('/context')) json = { context: { requestId: 'request-1', title: 'Купити соняшник', buyerId: 'viewer', sellerId: 'seller', unit: 'kg', currency: 'UAH', price: 120, offeredQuantity: 10, quantity: 10, remaining: 10, delivery: 'Самовивіз', deliveryPrice: 0, fulfillmentMode: 'single_seller', available: true }, proposals: [] };
    else if (path.endsWith('/messages') && method === 'GET') json = { messages, counterpartLastReadAt: new Date(yesterday.getTime() + 1000).toISOString() };
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
  await expect(page.locator('.messages-dialog .deal-chat-embedded > header h2')).toHaveText('Продати пшеницю');
  await expect(page).toHaveURL(/\/messages\/offer-sell\?filter=selling$/);
  await page.getByRole('button', { name: /Прямі чати 1/ }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await expect(page.locator('.conversation-row')).toContainText('Яблука');
  await expect(page.locator('.messages-dialog .deal-chat-embedded > header h2')).toHaveText('Яблука');
  await expect(page).toHaveURL(/\/messages\/direct\?filter=direct$/);

  await page.getByRole('button', { name: /Покупки 1/ }).click();
  await page.locator('.conversation-row').click();
  await expect(page.getByText('Сьогодні').last()).toBeVisible();
  await expect(page.getByText('Вчора').last()).toBeVisible();
  await expect(page.locator('.chat-message-status.read')).toHaveAttribute('aria-label', 'Прочитано');
  await expect(page.locator('.chat-message-status.sent')).toHaveAttribute('aria-label', 'Надіслано');
  await expect(page.locator('.chat-context-actions a')).toHaveAttribute('href', '/buy-requests/request-1');
  await page.getByRole('button', { name: /Усі чати 3/ }).click();

  const buyCardActions = page.locator('.conversation-row').filter({ hasText: 'Купити соняшник' }).getByRole('button', { name: 'Дії з чатом' });
  const sellCardActions = page.locator('.conversation-row').filter({ hasText: 'Продати пшеницю' }).getByRole('button', { name: 'Дії з чатом' });
  const headerActions = page.locator('.chat-context-actions').getByRole('button', { name: 'Дії з чатом' });
  const menu = page.locator('body > .chat-actions-menu:visible');

  await buyCardActions.click();
  await expect(menu).toBeVisible();
  await page.getByRole('heading', { name: 'Мої повідомлення' }).click();
  await expect(menu).toHaveCount(0);
  await sellCardActions.click();
  await expect(menu).toHaveCount(1);
  await expect(menu).toContainText('Додати в збережене');
  await page.getByRole('heading', { name: 'Мої повідомлення' }).click();
  await expect(menu).toHaveCount(0);
  await sellCardActions.click();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await sellCardActions.click();
  await page.getByRole('menuitem', { name: 'Поскаржитися на користувача' }).click();
  await expect(page.locator('.messages-dialog .deal-chat-embedded > header h2')).toHaveText('Купити соняшник');
  await expect(page.getByRole('heading', { name: 'Поскаржитися на користувача' })).toBeVisible();
  await page.getByRole('textbox', { name: 'Причина скарги' }).fill('Порушення правил спілкування');
  await page.getByRole('button', { name: 'Надіслати скаргу' }).click();
  await expect.poll(() => reportTargets).toEqual([{ targetType: 'user', targetId: 'buyer', reason: 'Порушення правил спілкування' }]);
  await sellCardActions.click();
  await page.getByRole('menuitem', { name: 'Заблокувати користувача' }).click();
  await expect(menu).toHaveCount(0);
  await sellCardActions.click();
  await page.getByRole('menuitem', { name: 'Розблокувати користувача' }).click();
  await expect.poll(() => blockTargets).toEqual(['POST /api/users/buyer/block', 'DELETE /api/users/buyer/block']);

  await page.getByRole('button', { name: /Усі чати 3/ }).click();
  for (const width of [1440, 1280, 1024, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth), `${width}px horizontal overflow`).toBeLessThanOrEqual(width + 1);
    const backToList = page.getByRole('button', { name: 'Повернутися до списку чатів' });
    if (width <= 700 && await backToList.isVisible()) await backToList.click();
    for (const title of ['Купити соняшник', 'Яблука']) {
      const action = page.locator('.conversation-row').filter({ hasText: title }).getByRole('button', { name: 'Дії з чатом' });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      const pathBefore = new URL(page.url()).pathname;
      await action.focus();
      await page.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      expect(new URL(page.url()).pathname).toBe(pathBefore);
      const geometry = await menu.evaluate((element) => {
        const rect = element.getBoundingClientRect();
        const item = element.querySelector('button[role="menuitem"]') as HTMLElement;
        const itemRect = item.getBoundingClientRect();
        const pointX = itemRect.left + itemRect.width / 2;
        const pointY = itemRect.top + itemRect.height / 2;
        const hit = document.elementFromPoint(pointX, pointY);
        return {
          inViewport: rect.left >= 0 && rect.top >= 0 && rect.right <= innerWidth && rect.bottom <= innerHeight,
          clickable: hit === item || item.contains(hit),
          visible: getComputedStyle(element).visibility === 'visible' && rect.width > 0 && rect.height > 0,
        };
      });
      expect(geometry, `${width}px, ${title}`).toEqual({ inViewport: true, clickable: true, visible: true });
      await page.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(action).toBeFocused();
      await action.click();
      await expect(menu).toBeVisible();
      await page.getByRole('heading', { name: 'Мої повідомлення' }).click();
      await expect(menu).toHaveCount(0);
    }
    if (width <= 700) {
      await page.locator('.conversation-row').filter({ hasText: 'Яблука' }).click();
      await expect(backToList).toBeVisible();
      await backToList.click();
      await expect(page.locator('.conversation-row').filter({ hasText: 'Яблука' })).toBeVisible();
    }
  }
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.getByRole('button', { name: /Покупки 1/ }).click();
  await buyCardActions.click();
  await page.getByRole('menuitem', { name: 'Додати в збережене' }).click();
  await expect(menu).toHaveCount(0);

  await page.getByRole('button', { name: 'Збережені' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('соняшник');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('немає такого чату');
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(page.locator('.messages-dialog .deal-chat-embedded')).toHaveCount(0);
  await expect(page).toHaveURL(/\/messages\?filter=saved$/);
  await page.getByLabel('Пошук у повідомленнях').fill('');
  await page.locator('.conversation-row').click();
  await expect(page.locator('.messages-dialog .deal-chat-embedded > header h2')).toHaveText('Купити соняшник');
  await buyCardActions.click();
  await page.getByRole('menuitem', { name: 'Прибрати зі збережених' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(page.locator('.messages-dialog .deal-chat-embedded')).toHaveCount(0);
  await expect(page.locator('.messages-dialog').getByText('Оберіть чат зі списку')).toBeVisible();
  await expect(page.locator('.messages-dialog').getByRole('textbox', { name: 'Повідомлення' })).toHaveCount(0);
  await expect(page).toHaveURL(/\/messages\?filter=saved$/);
  await page.getByRole('button', { name: /Усі чати 3/ }).click();
  await buyCardActions.click();
  await page.getByRole('menuitem', { name: 'Додати в збережене' }).click();
  await page.getByRole('button', { name: 'Збережені' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.reload();
  await expect(page.locator('.conversation-row')).toHaveCount(1);

  await headerActions.click();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await buyCardActions.click();
  await page.getByRole('menuitem', { name: 'Перемістити в кошик' }).click();
  await page.getByRole('button', { name: 'Перемістити', exact: true }).click();
  await expect(page.getByRole('button', { name: /Кошик.*Непрочитані повідомлення: 2/ })).toBeVisible();
  await page.getByRole('button', { name: /Кошик.*Непрочитані повідомлення: 2/ }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('Домовимось');
  await expect(page.locator('.conversation-row')).toHaveCount(1);
  await page.getByLabel('Пошук у повідомленнях').fill('');
  await page.locator('.conversation-row').click();
  await page.locator('.conversation-row').getByRole('button', { name: 'Дії з чатом' }).click();
  await page.getByRole('menuitem', { name: 'Відновити з кошика' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(page.locator('.messages-dialog .deal-chat-embedded')).toHaveCount(0);
  await expect(page).toHaveURL(/\/messages\?filter=trash$/);
  await page.getByRole('button', { name: 'Збережені' }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(1);

  await page.locator('.conversation-row').getByRole('button', { name: 'Дії з чатом' }).click();
  await page.getByRole('menuitem', { name: 'Перемістити в кошик' }).click();
  await page.getByRole('button', { name: 'Перемістити', exact: true }).click();
  await page.getByRole('button', { name: /Кошик/ }).click();
  await page.locator('.conversation-row').getByRole('button', { name: 'Дії з чатом' }).click();
  await page.getByRole('menuitem', { name: 'Видалити остаточно' }).click();
  await expect(page.getByRole('heading', { name: 'Видалити діалог?' })).toBeVisible();
  await page.getByRole('button', { name: 'Видалити', exact: true }).click();
  await expect(page.locator('.conversation-row')).toHaveCount(0);
  await expect(page.locator('.messages-dialog .deal-chat-embedded')).toHaveCount(0);
  await expect(page).toHaveURL(/\/messages\?filter=trash$/);
});
