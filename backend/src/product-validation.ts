export const PRODUCT_STATUSES = ['draft', 'active', 'paused', 'sold', 'expired'] as const
export const DELIVERY_MODES = ['pickup', 'seller_delivery', 'carrier'] as const
export const PRODUCT_UNITS = ['kg', 'ton', 'litre', 'piece', 'box'] as const

export type ProductStatus = typeof PRODUCT_STATUSES[number]
export type DeliveryMode = typeof DELIVERY_MODES[number]
export type ProductUnit = typeof PRODUCT_UNITS[number]

export type ProductInput = {
    categoryId: string
    title: string
    description?: string
    quantity: number
    unit: ProductUnit
    price: number
    currency: string
    deliveryMode: DeliveryMode
    geoZone: string
    latitude?: number | null
    longitude?: number | null
    status?: ProductStatus
    expiresAt?: string | null
    photos?: ProductPhotoInput[]
}

export type ProductPhotoInput = { url?: string; dataUrl?: string; alt?: string }

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const supportedPhotoProtocols = new Set(['http:', 'https:'])
const dataPhotoPattern = /^data:image\/(jpeg|png|webp|gif);base64,[a-z0-9+/=]+$/i

export const validateProductInput = (input: Record<string, unknown>, partial = false): string[] => {
    const errors: string[] = []
    const required = (field: string) => !partial || field in input
    if (required('categoryId') && (typeof input.categoryId !== 'string' || !uuidPattern.test(input.categoryId))) errors.push('categoryId')
    if (required('title') && (typeof input.title !== 'string' || input.title.trim().length < 2 || input.title.trim().length > 160)) errors.push('title')
    if (required('description') && input.description !== undefined && (typeof input.description !== 'string' || input.description.length > 5000)) errors.push('description')
    if (required('quantity') && (typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity <= 0)) errors.push('quantity')
    if (required('unit') && !PRODUCT_UNITS.includes(input.unit as ProductUnit)) errors.push('unit')
    if (required('price') && (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0)) errors.push('price')
    if (required('currency') && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) errors.push('currency')
    if (required('deliveryMode') && !DELIVERY_MODES.includes(input.deliveryMode as DeliveryMode)) errors.push('deliveryMode')
    if (required('geoZone') && (typeof input.geoZone !== 'string' || input.geoZone.trim().length < 1 || input.geoZone.length > 160)) errors.push('geoZone')
    if (input.latitude !== undefined && (input.latitude !== null && (typeof input.latitude !== 'number' || input.latitude < -90 || input.latitude > 90))) errors.push('latitude')
    if (input.longitude !== undefined && (input.longitude !== null && (typeof input.longitude !== 'number' || input.longitude < -180 || input.longitude > 180))) errors.push('longitude')
    if (input.status !== undefined && !PRODUCT_STATUSES.includes(input.status as ProductStatus)) errors.push('status')
    if (input.expiresAt !== undefined && input.expiresAt !== null && (typeof input.expiresAt !== 'string' || Number.isNaN(Date.parse(input.expiresAt)))) errors.push('expiresAt')
    if (input.photos !== undefined) {
        if (!Array.isArray(input.photos) || input.photos.length > 20) errors.push('photos')
        else input.photos.forEach((photo) => {
            if (!photo || typeof photo !== 'object') { errors.push('photos'); return }
            const photoInput = photo as ProductPhotoInput
            const hasRemoteUrl = typeof photoInput.url === 'string'
            const hasDataUrl = typeof photoInput.dataUrl === 'string'
            if (!hasRemoteUrl && !hasDataUrl) { errors.push('photos'); return }
            if (hasRemoteUrl) {
                try {
                    const url = new URL(photoInput.url!)
                    if (!supportedPhotoProtocols.has(url.protocol) || photoInput.url!.length > 2048) errors.push('photos')
                } catch { errors.push('photos') }
            }
            if (hasDataUrl && (!dataPhotoPattern.test(photoInput.dataUrl!) || photoInput.dataUrl!.length > 7_000_000)) errors.push('photos')
            if ((photo as ProductPhotoInput).alt !== undefined && (typeof (photo as ProductPhotoInput).alt !== 'string' || (photo as ProductPhotoInput).alt!.length > 200)) errors.push('photos')
        })
    }
    return [...new Set(errors)]
}
