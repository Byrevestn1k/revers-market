import { describe, expect, it } from 'vitest'
import { ExternalUrlPhotoStorage } from './photo-storage.js'
import { randomUUID } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'

describe('photo storage abstraction', () => {
    it('keeps external image storage replaceable behind a stable contract', async () => {
        const storage = new ExternalUrlPhotoStorage()
        await expect(storage.store('product-id', { url: 'https://cdn.example.com/photo.jpg' }, 0)).resolves.toEqual({
            storageKey: 'product-id/0', url: 'https://cdn.example.com/photo.jpg',
        })
        await expect(storage.remove('product-id/0')).resolves.toBeUndefined()
    })

    it('stores and removes browser-uploaded image data', async () => {
        const storage = new ExternalUrlPhotoStorage()
        const stored = await storage.store('storage-test-product', { dataUrl: 'data:image/png;base64,aGVsbG8=' }, 0)
        expect(stored).toEqual({ storageKey: 'storage-test-product/0.png', url: '/uploads/products/storage-test-product/0.png' })
        await expect(storage.remove(stored.storageKey)).resolves.toBeUndefined()
    })

    it('gives every copied product photo a distinct immutable file', async () => {
        const product = new ExternalUrlPhotoStorage('products')
        const offer = new ExternalUrlPhotoStorage('offers')
        const productId = randomUUID()
        const offerId = randomUUID()
        const source = await product.store(productId, { dataUrl: `data:image/png;base64,${Buffer.from('first-image').toString('base64')}` }, 0)
        const copied: string[] = []
        const bytes = (key: string) => readFile(fileURLToPath(new URL(`../uploads/offers/${key}`, import.meta.url)))
        try {
            const first = await offer.copyProductPhoto(offerId, source.url)
            copied.push(first.storageKey)
            const originalBytes = await bytes(first.storageKey)
            const second = await offer.copyProductPhoto(offerId, source.url)
            copied.push(second.storageKey)
            expect(second.storageKey).not.toBe(first.storageKey)
            expect(second.url).not.toBe(first.url)
            expect(await bytes(first.storageKey)).toEqual(originalBytes)
            expect(await bytes(second.storageKey)).toEqual(originalBytes)
            await offer.remove(second.storageKey)
            expect(await bytes(first.storageKey)).toEqual(originalBytes)
        } finally {
            for (const key of copied) await offer.remove(key)
            await product.remove(source.storageKey)
        }
    })

    it('keeps a missing legacy Product URL as a replaceable broken image', async () => {
        const offer = new ExternalUrlPhotoStorage('offers')
        const url = `/uploads/products/${randomUUID()}/0.png`
        const copied = await offer.copyProductPhoto(randomUUID(), url)
        expect(copied.url).toBe(url)
        await expect(offer.remove(copied.storageKey)).resolves.toBeUndefined()
    })
})
