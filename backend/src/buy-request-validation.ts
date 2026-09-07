export const BUY_REQUEST_STATUSES = ['open', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired'] as const
export const OFFER_STATUSES = ['draft', 'submitted', 'accepted', 'partially_accepted', 'rejected', 'withdrawn', 'expired'] as const
export const REQUEST_UNITS = ['kg', 'ton', 'litre', 'piece', 'box'] as const

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const validPrice = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value >= 0
const validQuantity = (value: unknown) => typeof value === 'number' && Number.isFinite(value) && value > 0
const validDate = (value: unknown) => typeof value === 'string' && !Number.isNaN(Date.parse(value))

export const validateBuyRequestInput = (input: Record<string, unknown>, partial = false): string[] => {
    const errors: string[] = []
    const required = (field: string) => !partial || field in input
    if (required('categoryId') && (typeof input.categoryId !== 'string' || !uuidPattern.test(input.categoryId))) errors.push('categoryId')
    if (input.productId !== undefined && input.productId !== null && (typeof input.productId !== 'string' || !uuidPattern.test(input.productId))) errors.push('productId')
    if (required('title') && (typeof input.title !== 'string' || input.title.trim().length < 2 || input.title.trim().length > 160)) errors.push('title')
    if (required('description') && (typeof input.description !== 'string' || input.description.length > 5000)) errors.push('description')
    if (required('quantity') && !validQuantity(input.quantity)) errors.push('quantity')
    if (required('unit') && !REQUEST_UNITS.includes(input.unit as typeof REQUEST_UNITS[number])) errors.push('unit')
    if (required('currency') && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) errors.push('currency')
    if (required('geoArea') && (typeof input.geoArea !== 'string' || input.geoArea.trim().length < 1 || input.geoArea.length > 160)) errors.push('geoArea')
    if (input.latitude !== undefined && (typeof input.latitude !== 'number' || !Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90)) errors.push('latitude')
    if (input.longitude !== undefined && (typeof input.longitude !== 'number' || !Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180)) errors.push('longitude')
    if (input.delivery !== undefined && !['no', 'yes', 'preferred'].includes(String(input.delivery))) errors.push('delivery')
    if (!partial && input.delivery === undefined && input.deliveryRequired === undefined) errors.push('delivery')
    if (input.deliveryRequired !== undefined && typeof input.deliveryRequired !== 'boolean') errors.push('deliveryRequired')
    if (input.preferredDelivery !== undefined && input.preferredDelivery !== null && (typeof input.preferredDelivery !== 'string' || input.preferredDelivery.length > 160)) errors.push('preferredDelivery')
    if (input.address !== undefined && input.address !== null && (typeof input.address !== 'string' || input.address.length > 500)) errors.push('address')
    if (input.minPrice !== undefined && input.minPrice !== null && !validPrice(input.minPrice)) errors.push('minPrice')
    if (input.maxPrice !== undefined && input.maxPrice !== null && !validPrice(input.maxPrice)) errors.push('maxPrice')
    if (input.exactPrice !== undefined && input.exactPrice !== null && !validPrice(input.exactPrice)) errors.push('exactPrice')
    if (input.exactPrice !== undefined && input.exactPrice !== null && (input.minPrice !== undefined || input.maxPrice !== undefined)) errors.push('priceMode')
    if (validPrice(input.minPrice) && validPrice(input.maxPrice) && (input.minPrice as number) > (input.maxPrice as number)) errors.push('priceRange')
    if (!partial && input.exactPrice === undefined && input.minPrice === undefined && input.maxPrice === undefined) errors.push('price')
    if (input.deadline !== undefined && input.deadline !== null && !validDate(input.deadline)) errors.push('deadline')
    if (input.status !== undefined && !BUY_REQUEST_STATUSES.includes(input.status as typeof BUY_REQUEST_STATUSES[number])) errors.push('status')
    return [...new Set(errors)]
}

export const validateOfferInput = (input: Record<string, unknown>, partial = false): string[] => {
    const errors: string[] = []
    const required = (field: string) => !partial || field in input
    if (required('quantity') && !validQuantity(input.quantity)) errors.push('quantity')
    if (input.productId !== undefined && input.productId !== null && (typeof input.productId !== 'string' || !uuidPattern.test(input.productId))) errors.push('productId')
    if (required('unit') && !REQUEST_UNITS.includes(input.unit as typeof REQUEST_UNITS[number])) errors.push('unit')
    if (required('price') && !validPrice(input.price)) errors.push('price')
    if (required('currency') && (typeof input.currency !== 'string' || !/^[A-Z]{3}$/.test(input.currency))) errors.push('currency')
    if (required('delivery') && (typeof input.delivery !== 'string' || input.delivery.trim().length < 1 || input.delivery.length > 160)) errors.push('delivery')
    if (input.note !== undefined && (typeof input.note !== 'string' || input.note.length > 5000)) errors.push('note')
    if (input.additionalPhotoUrl !== undefined && input.additionalPhotoUrl !== null) {
        try { const url = new URL(String(input.additionalPhotoUrl)); if (!['http:', 'https:'].includes(url.protocol) || String(input.additionalPhotoUrl).length > 2048) errors.push('additionalPhotoUrl') } catch { errors.push('additionalPhotoUrl') }
    }
    if (input.validUntil !== undefined && input.validUntil !== null && !validDate(input.validUntil)) errors.push('validUntil')
    return [...new Set(errors)]
}