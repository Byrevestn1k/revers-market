import { mkdir, unlink, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export type StoredPhoto = { storageKey: string; url: string }
export type PhotoUpload = { url?: string; dataUrl?: string; alt?: string }

export interface PhotoStorage {
    store(productId: string, photo: PhotoUpload, index: number): Promise<StoredPhoto>
    remove(storageKey: string): Promise<void>
}

export class ExternalUrlPhotoStorage implements PhotoStorage {
    constructor(private readonly kind: 'products' | 'buy-requests' = 'products') {}

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
