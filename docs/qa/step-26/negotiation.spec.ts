import { test, expect } from '@playwright/test'
import { randomUUID } from 'node:crypto'
import { mkdir } from 'node:fs/promises'

if (process.env.DATABASE_URL !== 'postgresql://step26_test:step26_test@127.0.0.1:55433/step26_test') throw new Error('Step 26 requires its isolated database')
test.setTimeout(300_000)

test('desktop counteroffer, rejection and insufficient stock', async ({ browser, request }) => {
  const suffix = String(Date.now()), password = 'StrongPassword1'
  const buyer = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width: 1280, height: 900 } })
  const seller = await browser.newContext({ baseURL: 'http://127.0.0.1:5179', viewport: { width: 1280, height: 900 } })
  try {
    for (const [context, prefix] of [[buyer, '50'], [seller, '67']] as const) {
      const username = `s26n_${prefix}_${suffix}`
      const response = await context.request.post('/api/auth/register', { data: { username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${prefix}${suffix.slice(-7)}`, password, passwordConfirmation: password } })
      expect(response.status(), await response.text()).toBe(201)
    }
    const categories = (await (await request.get('http://127.0.0.1:33026/api/categories')).json()).categories
    const category = categories.find((item: { code: string }) => item.code === 'grains')
    const prepare = async (title: string) => {
      const created = await seller.request.post('/api/products', { data: { categoryId: category.id, title, quantity: 10, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }], geoZone: 'Київ', status: 'active', photos: [] } })
      expect(created.status(), await created.text()).toBe(201)
      const productId = (await created.json()).product.id
      const conversation = await buyer.request.post(`/api/products/${productId}/conversation`, { data: {} })
      const conversationId = (await conversation.json()).conversation.id
      const path = `/api/conversations/${conversationId}/direct-proposals`
      const context = (await (await buyer.request.get(path)).json()).context
      const proposal = await buyer.request.post(path, { data: { action: 'propose', requestKey: randomUUID(), parentId: null, expectedTermsToken: context.termsToken, expectedCurrency: context.currency, expectedUnit: context.unit, expectedProductPrice: context.price, expectedDeliveryOptions: context.deliveryOptions, price: 100, quantity: 7, delivery: 'SELF_PICKUP', postalOperator: null, deliveryPrice: 0 } })
      expect(proposal.status(), await proposal.text()).toBe(200)
      return { productId, conversationId }
    }
    const sellerPage = await seller.newPage(), buyerPage = await buyer.newPage()
    await mkdir('docs/qa/step-26/screenshots', { recursive: true })
    const counter = await prepare('Тест переговорів')
    await sellerPage.goto(`/messages/${counter.conversationId}`)
    await sellerPage.getByRole('button', { name: 'Запропонувати інші умови' }).click()
    const form = sellerPage.locator('.direct-proposal-form')
    await form.locator('input[name="price"]').fill('90')
    await form.getByRole('button', { name: 'Надіслати пропозицію' }).click()
    await expect(sellerPage.getByText('90 USD за одиницю', { exact: false }).first()).toBeVisible()
    await expect(sellerPage.getByRole('textbox', { name: 'Повідомлення', exact: true })).toBeInViewport()
    await buyerPage.goto(`/messages/${counter.conversationId}`)
    await expect(buyerPage.getByText('90 USD за одиницю', { exact: false }).first()).toBeVisible()
    await buyerPage.getByRole('button', { name: 'Прийняти умови' }).click()
    await expect(buyerPage.getByText('Умови погоджено', { exact: false }).first()).toBeVisible()
    await buyerPage.screenshot({ path: 'docs/qa/step-26/screenshots/counteroffer-1280.png', fullPage: true })
    expect((await seller.request.patch(`/api/products/${counter.productId}`, { data: { title: 'Змінена назва товару', price: 200 } })).status()).toBe(200)
    await buyerPage.goto('/orders')
    await expect(buyerPage.getByRole('heading', { name: 'Тест переговорів' })).toBeVisible()
    await expect(buyerPage.getByText('90 $ / kg', { exact: false }).first()).toBeVisible()
    const rejected = await prepare('Тест відхилення')
    await sellerPage.goto(`/messages/${rejected.conversationId}`)
    await sellerPage.getByRole('button', { name: 'Відхилити', exact: true }).click()
    await expect(sellerPage.getByText('Відхилено', { exact: true })).toBeVisible()
    const shortage = await prepare('Тест нестачі')
    const changed = await seller.request.patch(`/api/products/${shortage.productId}`, { data: { quantity: 2 } })
    expect(changed.status(), await changed.text()).toBe(200)
    await sellerPage.goto(`/messages/${shortage.conversationId}`)
    await sellerPage.getByRole('button', { name: 'Прийняти умови' }).click()
    await expect(sellerPage.getByRole('alert')).toContainText('кількості')
  } finally { await buyer.close(); await seller.close() }
})
