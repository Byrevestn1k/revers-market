import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import request from 'supertest'
import sharp from 'sharp'
import { ExternalUrlPhotoStorage } from './photo-storage.js'

if (process.env.DATABASE_URL) {
    const { createApp } = await import('./app.js')

    describe('photo thumbnails', () => {
        it('serves a burst of distinct thumbnails without dropping normal requests', async () => {
            const storage = new ExternalUrlPhotoStorage('products')
            const photos: { storageKey: string; url: string }[] = []
            const id = randomUUID()
            const bytes = await sharp({ create: { width: 640, height: 480, channels: 3, background: '#b7c3d1' } }).png().toBuffer()
            try {
                for (let index = 0; index < 12; index++) photos.push(await storage.store(id, { dataUrl: `data:image/png;base64,${bytes.toString('base64')}` }, index))
                const app = createApp()
                const responses = await Promise.all(photos.map(photo => request(app).get('/api/photo-thumbnail').query({ path: photo.url })))
                expect(responses.map(response => response.status)).toEqual(Array(12).fill(200))
                for (const response of responses) {
                    expect(response.headers['content-type']).toMatch(/^image\/webp/)
                    expect((await sharp(response.body).metadata()).width).toBeLessThanOrEqual(320)
                }
                expect((await request(app).get('/api/photo-thumbnail').query({ path: '/uploads/products/../../.env' })).status).toBe(404)
            } finally {
                for (const photo of photos) await storage.remove(photo.storageKey)
            }
        }, 60_000)
    })
} else {
    describe.skip('photo thumbnails (requires DATABASE_URL)', () => {
        it('serves thumbnails', () => {})
    })
}
