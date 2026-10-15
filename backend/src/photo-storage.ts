import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type StoredPhoto = { storageKey: string; url: string }
export type PhotoUpload = { url?: string; dataUrl?: string; alt?: string }

export interface PhotoStorage {
    store(productId: string, photo: PhotoUpload, index: number): Promise<StoredPhoto>
    remove(storageKey: string): Promise<void>
}

export class ExternalUrlPhotoStorage implements PhotoStorage {
    constructor(private readonly kind: 'products' | 'buy-requests' | 'offers' = 'products') {}

    async copyProductPhoto(offerId: string, url: string, index: number): Promise<StoredPhoto> {
        const match = url.match(/^\/uploads\/products\/([0-9a-f-]{36})\/(\d+)\.(jpg|png|webp|gif)$/i)
        if (!match) return this.store(`${offerId}/copied-${index}`, { url }, index)
        const source = join(dirname(fileURLToPath(import.meta.url)), '../uploads/products', match[1], `${match[2]}.${match[3]}`)
        const bytes = await readFile(source)
        const mime = match[3].toLowerCase() === 'jpg' ? 'jpeg' : match[3].toLowerCase()
        return this.store(`${offerId}/copied-${index}`, { dataUrl: `data:image/${mime};base64,${bytes.toString('base64')}` }, index)
    }

    async store(productId: string, photo: PhotoUpload, index: number): Promise<StoredPhoto> {
        if (photo.dataUrl) {
            const match = photo.dataUrl.match(/^data:image\/(jpeg|png|webp|gif);base64,(.+)$/i)
            if (!match) throw new Error('Unsupported image format')
            const extension = match[1].toLowerCase() === 'jpeg' ? 'jpg' : match[1].toLowerCase()
            const storageKey = `${productId}/${index}.${extension}`
            const filePath = join(dirname(fileURLToPath(import.meta.url)), `../uploads/${this.kind}`, storageKey)
            await mkdir(dirname(filePath), { recursive: true })
            await writeFile(filePath, Buffer.from(match[2], 'base64'))
            return { storageKey, url: `/uploads/${this.kind}/${storageKey}` }
        }
        if (!photo.url) throw new Error('Photo URL is required')
        return { storageKey: `${productId}/${index}`, url: photo.url }
    }

    async remove(storageKey: string): Promise<void> {
        if (!storageKey.includes('.') || storageKey.includes('..')) return
        await unlink(join(dirname(fileURLToPath(import.meta.url)), `../uploads/${this.kind}`, storageKey)).catch(() => undefined)
    }
}
