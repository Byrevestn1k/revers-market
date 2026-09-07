import { describe, expect, it } from 'vitest'
import { ExternalUrlPhotoStorage } from './photo-storage.js'

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
})
