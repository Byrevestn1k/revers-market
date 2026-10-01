import { expect, test } from '@playwright/test'

test('notification retry clears a failed read error after the list reloads', async ({ page }) => {
  let failRead = true
  const notification = { id: 'notification', type: 'system', title: 'Нова подія', body: 'Тестове сповіщення', context: 'buying', orderId: null, conversationId: null, buyRequestId: null, readAt: null, createdAt: new Date().toISOString() }
  await page.route('**/api/**', async route => {
    const path = new URL(route.request().url()).pathname
    const method = route.request().method()
    if (path === '/api/auth/me') return route.fulfill({ json: { user: { id: 'viewer', username: 'QA' } } })
    if (path === '/api/categories') return route.fulfill({ json: { categories: [] } })
    if (path === '/api/profile/me') return route.fulfill({ json: { profile: { id: 'viewer', avatarUrl: null } } })
    if (path.startsWith('/api/products')) return route.fulfill({ json: { products: [], pagination: { page: 1, pages: 1 } } })
    if (path === '/api/notifications' && method === 'GET') return route.fulfill({ json: { notifications: [notification], unreadCounts: { total: 1, buying: 1, selling: 0 } } })
    if (path === '/api/notifications/read' && method === 'PATCH') {
      if (failRead) return route.fulfill({ status: 503, json: { message: 'Тимчасова помилка' } })
      notification.readAt = new Date().toISOString()
      return route.fulfill({ json: { ok: true } })
    }
    return route.fulfill({ json: {} })
  })

  await page.goto('/notifications', { waitUntil: 'domcontentloaded' })
  await page.getByRole('tab', { name: /Купівля/ }).click()
  await page.getByRole('button', { name: 'Позначити прочитаним' }).click()
  await expect(page.getByRole('alert')).toContainText('Тимчасова помилка')

  failRead = false
  await page.getByRole('button', { name: 'Оновити список' }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Прочитати всі' })).toBeEnabled()
})
