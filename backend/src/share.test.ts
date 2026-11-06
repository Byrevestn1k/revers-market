import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Request } from 'express'

const mocks = vi.hoisted(() => ({ product: vi.fn(), request: vi.fn(), profile: vi.fn(), reviews: vi.fn(), query: vi.fn() }))
vi.mock('./products.js', () => ({ getProduct: mocks.product }))
vi.mock('./buy-requests.js', () => ({ getBuyRequest: mocks.request }))
vi.mock('./profiles.js', () => ({ getPublicProfile: mocks.profile }))
vi.mock('./community-service.js', () => ({ listReviews: mocks.reviews }))
vi.mock('./db/client.js', () => ({ pool: { query: mocks.query } }))
import { getShareAvatar, getSharePayload, injectShareMetadata, publicOrigin } from './share.js'

const id = 'b1e0a0e1-1111-4111-8111-111111111111'
const req = { query: {}, headers: { host: 'attacker.example' } } as unknown as Request
describe('public sharing', () => {
    beforeEach(() => {
        process.env.PUBLIC_ORIGIN = 'https://example.org'
        mocks.product.mockReset(); mocks.request.mockReset(); mocks.profile.mockReset(); mocks.reviews.mockReset(); mocks.query.mockReset()
    })
    it('uses an explicit origin and escapes HTML metadata', () => {
        expect(() => publicOrigin('https://example.org/path')).toThrow()
        expect(() => publicOrigin('http://example.org')).toThrow()
        const html = injectShareMetadata('<head></head>', { type: 'product', title: '<script>"', description: "a'&b", publicUrl: 'https://example.org/x', previewImage: 'https://example.org/brand/logo-mini.png', shareText: '' })
        expect(html).toContain('&lt;script&gt;&quot;')
        expect(html).toContain('a&#39;&amp;b')
        expect(html).not.toContain('<script>')
        expect(html).toContain('og:url')
    })
    it('formats a product using its own currency, quantity and fallback image', async () => {
        mocks.product.mockResolvedValue({ body: { product: { id, title: 'Вулик & мед', price: { amount: 12, currency: 'EUR' }, quantity: 5, availableQuantity: 3, unit: 'kg', description: 'Опис', settlement: null, owner: { username: 'Пасіка' }, photos: [] } } })
        const value = await getSharePayload('product', id, req)
        expect(value?.shareText).toContain('12 EUR / кг')
        expect(value?.shareText).toContain('3 кг')
        expect(value?.previewImage).toBe('https://example.org/brand/logo-mini.png')
        expect(value?.publicUrl).toBe(`https://example.org/products/${id}`)
    })
    it('excludes closed requests and omits an absent budget', async () => {
        const item = { id, status: 'closed', title: 'Шукаю', quantity: 2, unit: 'piece', description: '', settlement: null, price: { min: null as number | null, max: null as number | null, currency: 'UAH' }, photos: [] }
        mocks.request.mockResolvedValue({ body: { buyRequest: item } })
        expect(await getSharePayload('buy_request', id, req)).toBeNull()
        item.status = 'open'
        expect((await getSharePayload('buy_request', id, req))?.shareText).not.toContain('Бюджет:')
        item.price.max = 150
        expect((await getSharePayload('buy_request', id, req))?.shareText).toContain('до 150 UAH / шт.')
    })
    it('rejects invalid and unavailable IDs and limits long descriptions', async () => {
        expect(await getSharePayload('product', 'not-a-uuid', req)).toBeNull()
        mocks.product.mockResolvedValue({ body: { error: 'PRODUCT_NOT_FOUND' } })
        expect(await getSharePayload('product', id, req)).toBeNull()
        mocks.product.mockResolvedValue({ body: { product: { id, title: 'Назва <&>', price: null, quantity: null, unit: 'box', description: 'т'.repeat(5000), settlement: null, owner: {}, photos: [{ url: '/uploads/products/../private' }] } } })
        const value = await getSharePayload('product', id, req)
        expect(value?.shareText).toContain('Ціна не вказана')
        expect(value?.shareText).not.toContain('Кількість:')
        expect(value!.description.length).toBeLessThanOrEqual(240)
        expect(value?.previewImage).toBe('https://example.org/brand/logo-mini.png')
    })
    it('publishes separate role ratings and excludes private review identifiers', async () => {
        mocks.profile.mockResolvedValue({ body: { profile: { username: 'seller', nickname: 'Продавець', bio: '', avatarUrl: null, sellerRating: { average: 10, count: 1 }, buyerRating: { average: null, count: 0 } } } })
        mocks.reviews.mockResolvedValue({ body: { reviews: [{ id, rating: 10, body: 'Добре', reviewerUsername: 'buyer', orderId: 'secret-deal' }] } })
        mocks.query.mockResolvedValue({ rowCount: 1, rows: [{ role: 'продавця' }] })
        expect((await getSharePayload('profile', 'seller', req))?.shareText).toContain('Рейтинг продавця: 10/12')
        expect((await getSharePayload('profile', 'seller', req))?.shareText).not.toContain('Рейтинг покупця:')
        const review = await getSharePayload('review', 'seller', req, id)
        expect(JSON.stringify(review)).not.toContain('secret-deal')
        expect(review?.publicUrl).toContain(`?review=${id}`)
        mocks.reviews.mockResolvedValue({ body: { reviews: [] } })
        expect(await getSharePayload('review', 'seller', req, id)).toBeNull()
    })
    it('exposes only the public avatar image bytes', async () => {
        const profile = { username: 'seller', nickname: null, bio: '', avatarUrl: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/a5sAAAAASUVORK5CYII=', sellerRating: { average: null, count: 0 }, buyerRating: { average: null, count: 0 } }
        mocks.profile.mockResolvedValue({ body: { profile } })
        const value = await getSharePayload('profile', 'seller', req)
        expect(value?.previewImage).toBe('https://example.org/api/share-avatar/seller')
        expect((await getShareAvatar('seller', req))?.subarray(0, 4).toString('hex')).toBe('89504e47')
        expect(mocks.profile.mock.calls[0][1].authUser).toBeUndefined()
        profile.avatarUrl = 'data:image/png;base64,YWJj'
        expect((await getSharePayload('profile', 'seller', req))?.previewImage).toBe('https://example.org/brand/logo-mini.png')
    })
})
