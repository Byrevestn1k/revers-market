export type EditableOffer = {
    existingProduct: { id: string } | null
    quantity: number
    price: { amount: number }
    delivery: string
    note: string
    additionalPhotoUrl?: string | null
    validUntil?: string | null
    termsSnapshot?: { availableAt?: string }
    deliverySnapshot?: { price?: number }
}

export function buildOfferUpdatePayload(offer: EditableOffer, values: Record<string, string>): Record<string, unknown> {
    const productId = values.productId || null
    const validUntil = values.validUntil ? new Date(values.validUntil + 'T23:59:59').toISOString() : null
    const payload: Record<string, unknown> = {}
    if (productId !== (offer.existingProduct?.id ?? null)) payload.productId = productId
    if (Number(values.quantity) !== offer.quantity) payload.quantity = Number(values.quantity)
    if (Number(values.price) !== offer.price.amount) payload.price = Number(values.price)
    if (values.delivery !== offer.delivery) payload.delivery = values.delivery
    if (Number(values.deliveryPrice || 0) !== (offer.deliverySnapshot?.price ?? 0)) payload.deliveryPrice = Number(values.deliveryPrice || 0)
    if ((values.availableAt || '') !== (offer.termsSnapshot?.availableAt ?? '')) payload.availableAt = values.availableAt || ''
    if ((values.note || '') !== offer.note) payload.note = values.note || ''
    if ((values.additionalPhotoUrl || null) !== (offer.additionalPhotoUrl ?? null)) payload.additionalPhotoUrl = values.additionalPhotoUrl || null
    if ((values.validUntil || '') !== (offer.validUntil?.slice(0, 10) ?? '')) payload.validUntil = validUntil
    return payload
}
