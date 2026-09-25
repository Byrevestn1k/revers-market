import { getSettlement } from './settlements.js'
import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { validateBuyRequestInput, validateOfferInput } from './buy-request-validation.js'
import { approximatePoint } from './map-service.js'
import { createOrderConversation } from './order-service.js'
import { refreshRequestQuantities } from './request-quantities.js'
import { audit, createNotification, usersAreBlocked } from './community-service.js'
import { buildUpdate, withOwnerConditions } from './dynamic-update.js'
import { categoryFilterSql } from './category-filter.js'

type Queryable = Pick<PoolClient, 'query'>
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const number = (value: string | number | null) => value === null ? null : Number(value)
const invalid = (fields: string[]) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте дані запиту', fields } })

const asNumberOrNull = (value: unknown): number | null => {
    if (value === undefined || value === null) return null
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
}
const asDateOrNull = (value: unknown): string | null => {
    if (typeof value !== 'string') return null
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? null : date.toISOString()
}

const requestSelect = `SELECT r.*, c.code AS category_code, c.name AS category_name, u.username AS buyer_username
    FROM buy_requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.buyer_id`
const offerSelect = `SELECT o.*, u.username AS seller_username, p.title AS product_title,
    CASE WHEN u.rating_count > 0 THEN round(u.rating_sum / u.rating_count, 2) ELSE NULL END AS seller_rating,
    u.avatar_url AS seller_avatar,
    (SELECT jsonb_agg(jsonb_build_object('url', pp.url) ORDER BY pp.sort_order) FROM product_photos pp WHERE pp.product_id = o.product_id) AS product_photos,
    EXISTS (SELECT 1 FROM negotiation_proposals np WHERE np.offer_id = o.id AND np.status = 'pending' AND np.created_by <> o.seller_id) AS pending_negotiation,
    EXISTS (SELECT 1 FROM orders so WHERE so.offer_id = o.id AND so.status = 'selected') AS waiting_confirmation,
    (SELECT count(*)::int FROM orders d WHERE (d.seller_id = u.id OR d.buyer_id = u.id) AND d.status = 'completed' AND d.buyer_completed_at IS NOT NULL AND d.seller_completed_at IS NOT NULL) AS seller_deals
    FROM offers o JOIN users u ON u.id = o.seller_id LEFT JOIN products p ON p.id = o.product_id`

interface BuyRequestRow {
    settlement_code?: string | null
    id: string
    buyer_id: string
    buyer_username: string
    category_id: string
    category_code: string
    category_name: string
    product_id: string | null
    title: string
    description: string
    requested_quantity: string | number
    fulfilled_quantity: string | number
    selected_quantity: string | number
    completed_quantity: string | number
    fulfillment_mode: 'single_seller' | 'multiple_sellers'
    unit: string
    min_unit_price: string | number | null
    max_unit_price: string | number | null
    currency: string
    delivery_required: boolean
    preferred_delivery: string | null
    delivery_address: string | null
    address_visibility: 'private' | 'public'
    map_location_mode: 'profile' | 'pin' | 'address' | 'approximate'
    geo_area: string
    latitude: string | number | null
    longitude: string | number | null
    deadline: Date | null
    status: string
    created_at: Date
    updated_at: Date
}

interface OfferRow {
    product_photos?: { url: string }[]
    pending_negotiation?: boolean
    waiting_confirmation?: boolean
    seller_rating?: string | null
    seller_avatar?: string | null
    seller_deals?: number
    id: string
    buy_request_id: string
    seller_id: string
    seller_username: string
    product_id: string | null
    product_title: string | null
    offered_quantity: string | number
    accepted_quantity: string | number
    unit: string
    unit_price: string | number
    currency: string
    delivery: unknown
    note: string
    additional_photo_url: string | null
    terms: unknown
    delivery_terms: unknown
    status: string
    valid_until: Date | null
    created_at: Date
}

const requestDto = (row: BuyRequestRow, includeAddress = false) => ({
    id: row.id, buyer: { id: row.buyer_id, username: row.buyer_username },
    category: { id: row.category_id, code: row.category_code, name: row.category_name },
    productId: row.product_id, title: row.title, description: row.description,
    quantity: Number(row.requested_quantity), fulfilledQuantity: Number(row.fulfilled_quantity), selectedQuantity: Number(row.selected_quantity ?? 0), completedQuantity: Number(row.completed_quantity ?? row.fulfilled_quantity), remainingQuantity: Number(row.requested_quantity) - Number(row.selected_quantity ?? 0) - Number(row.completed_quantity ?? row.fulfilled_quantity), fulfillmentMode: row.fulfillment_mode, unit: row.unit,
    price: { min: number(row.min_unit_price), max: number(row.max_unit_price), currency: row.currency },
    delivery: { required: row.delivery_required, preferred: row.preferred_delivery, address: includeAddress || row.address_visibility === 'public' ? row.delivery_address : null },
    addressVisibility: row.address_visibility,
    mapLocationMode: row.map_location_mode,
    geoArea: row.geo_area, settlement: getSettlement(row.settlement_code), coordinates: row.latitude === null || row.longitude === null ? null : includeAddress || row.address_visibility === 'public' || ['pin', 'address'].includes(row.map_location_mode) ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : approximatePoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }), deadline: row.deadline?.toISOString() ?? null, status: row.status,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
})
const offerDto = (row: OfferRow) => ({
    id: row.id, seller: { id: row.seller_id, username: row.seller_username, rating: row.seller_rating == null ? null : Number(row.seller_rating), avatarUrl: row.seller_avatar, completedDeals: row.seller_deals ?? 0 }, buyRequestId: row.buy_request_id,
    existingProduct: row.product_id ? { id: row.product_id, title: row.product_title } : null,
    quantity: Number(row.offered_quantity), acceptedQuantity: Number(row.accepted_quantity), unit: row.unit,
    price: { amount: Number(row.unit_price), currency: row.currency }, delivery: row.delivery, note: row.note,
    additionalPhotoUrl: row.additional_photo_url, termsSnapshot: row.terms, deliverySnapshot: row.delivery_terms,
    photos: row.product_photos ?? [], pendingNegotiation: row.pending_negotiation, waitingConfirmation: row.waiting_confirmation,
    status: row.status, validUntil: row.valid_until?.toISOString() ?? null, createdAt: row.created_at.toISOString(),
})

const categoryExists = async (queryable: Queryable, id: string) => Boolean((await queryable.query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [id])).rowCount)

type AcceptanceCheck = { ok: true } | { ok: false; status: number; body: Record<string, string> }

const validateAcceptance = (
    offer: { status: string; valid_until: Date | string | null; offered_quantity: string | number; accepted_quantity: string | number },
    request: { status: string; requested_quantity: string | number; selected_quantity: string | number; completed_quantity: string | number; fulfillment_mode: 'single_seller' | 'multiple_sellers' },
    quantity: number,
): AcceptanceCheck => {
    const acceptableOfferStatuses = ['submitted', 'partially_accepted']
    if (!acceptableOfferStatuses.includes(offer.status)) return { ok: false, status: 409, body: { error: 'OFFER_OR_REQUEST_NOT_ACCEPTABLE' } }
    if (offer.valid_until && new Date(offer.valid_until) <= new Date()) return { ok: false, status: 409, body: { error: 'OFFER_OR_REQUEST_NOT_ACCEPTABLE' } }
    const acceptableRequestStatuses = ['open', 'partially_selected', 'partially_completed', 'partially_fulfilled']
    if (!acceptableRequestStatuses.includes(request.status)) return { ok: false, status: 409, body: { error: 'OFFER_OR_REQUEST_NOT_ACCEPTABLE' } }
    const remainingOffer = Number(offer.offered_quantity) - Number(offer.accepted_quantity)
    const remainingRequest = Number(request.requested_quantity) - Number(request.selected_quantity) - Number(request.completed_quantity)
    if (request.fulfillment_mode === 'single_seller' && remainingOffer < remainingRequest) return { ok: false, status: 409, body: { error: 'OFFER_QUANTITY_INSUFFICIENT' } }
    if (quantity > remainingOffer || quantity > remainingRequest) return { ok: false, status: 409, body: { error: 'QUANTITY_EXCEEDS_REMAINING' } }
    return { ok: true }
}

export const createBuyRequest = async (user: AuthUser, input: Record<string, unknown>) => {
    const errors = validateBuyRequestInput(input)
    if (errors.length) return invalid(errors)
    if (!(await categoryExists(pool, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE' } }
    const exactPrice = asNumberOrNull(input.exactPrice)
    const minPrice = asNumberOrNull(input.minPrice)
    const maxPrice = asNumberOrNull(input.maxPrice)
    const latitude = asNumberOrNull(input.latitude)
    const longitude = asNumberOrNull(input.longitude)
    if (input.exactPrice !== undefined && input.exactPrice !== null && exactPrice === null) return invalid(['exactPrice'])
    if (input.minPrice !== undefined && input.minPrice !== null && minPrice === null) return invalid(['minPrice'])
    if (input.maxPrice !== undefined && input.maxPrice !== null && maxPrice === null) return invalid(['maxPrice'])
    if (input.latitude !== undefined && input.latitude !== null && latitude === null) return invalid(['latitude'])
    if (input.longitude !== undefined && input.longitude !== null && longitude === null) return invalid(['longitude'])
    const deadline = input.deadline === undefined || input.deadline === null ? null : asDateOrNull(input.deadline)
    if (input.deadline != null && deadline === null) return invalid(['deadline'])
    if (latitude !== null && (latitude < -90 || latitude > 90)) return invalid(['latitude'])
    if (longitude !== null && (longitude < -180 || longitude > 180)) return invalid(['longitude'])
    const deliveryRequired = input.delivery === 'yes' || input.delivery === 'preferred' || input.deliveryRequired === true
    const preferredDelivery = input.preferredDelivery ?? (input.delivery === 'preferred' ? 'preferred' : null)
    const created = await pool.query<{ id: string }>(
        'INSERT INTO buy_requests (buyer_id, category_id, product_id, title, description, requested_quantity, unit, currency, min_unit_price, max_unit_price, delivery_required, preferred_delivery, geo_area, delivery_address, latitude, longitude, deadline, settlement_code, address_visibility, map_location_mode, fulfillment_mode) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) RETURNING id',
        [user.id, input.categoryId, input.productId ?? null, String(input.title).trim(), input.description ?? '', input.quantity, input.unit, input.currency, exactPrice ?? minPrice, exactPrice ?? maxPrice, deliveryRequired, preferredDelivery, String(input.geoArea).trim(), input.address ?? null, latitude, longitude, deadline, input.settlementCode ?? null, input.addressVisibility ?? 'private', input.mapLocationMode ?? 'profile', input.fulfillmentMode ?? 'multiple_sellers'],
    )
    const response = await getBuyRequest(created.rows[0].id, user)
    return { ...response, status: 201 }
}

export const getBuyRequest = async (id: string, user?: AuthUser) => {
    const result = await pool.query(`${requestSelect} WHERE r.id = $1 AND (r.status <> 'cancelled' OR r.buyer_id = $2)`, [id, user?.id ?? null])
    if (!result.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    const isOwner = user?.id === result.rows[0].buyer_id
    return { status: 200, body: { buyRequest: requestDto(result.rows[0], isOwner) } }
}

export const listBuyRequests = async (query: Record<string, unknown>, user?: AuthUser) => {
    const params: unknown[] = []
    const conditions = [user && query.mine === 'true' ? `r.buyer_id = $${params.push(user.id)}` : `r.status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')`]
    if (typeof query.buyerUsername === 'string' && query.buyerUsername.trim()) { params.push(query.buyerUsername.trim().toLowerCase()); conditions.push(`u.username_normalized = $${params.length}`) }
    if (typeof query.categoryId === 'string' && uuid(query.categoryId)) conditions.push(categoryFilterSql('r.category_id', params.push(query.categoryId)))
    const result = await pool.query(`${requestSelect} WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC LIMIT 50`, params)
    return { status: 200, body: { buyRequests: result.rows.map((row) => requestDto(row, user?.id === row.buyer_id)) } }
}

export const updateBuyRequest = async (user: AuthUser, id: string, input: Record<string, unknown>) => {
    if ('geoArea' in input && !('settlementCode' in input)) input = { ...input, settlementCode: null }
    if (getSettlement(input.settlementCode) && !('geoArea' in input)) input = { ...input, geoArea: getSettlement(input.settlementCode)!.name }
    const errors = validateBuyRequestInput(input, true)
    if (errors.length) return invalid(errors)
    const normalizedInput = { ...input }
    if (input.exactPrice !== undefined) { normalizedInput.minPrice = input.exactPrice; normalizedInput.maxPrice = input.exactPrice }
    if (input.delivery !== undefined) { normalizedInput.deliveryRequired = input.delivery !== 'no'; if (input.delivery === 'preferred') normalizedInput.preferredDelivery = input.preferredDelivery ?? 'preferred' }
    const allowed: Record<string, string> = { categoryId: 'category_id', productId: 'product_id', title: 'title', description: 'description', quantity: 'requested_quantity', unit: 'unit', currency: 'currency', minPrice: 'min_unit_price', maxPrice: 'max_unit_price', deliveryRequired: 'delivery_required', preferredDelivery: 'preferred_delivery', geoArea: 'geo_area', settlementCode: 'settlement_code', address: 'delivery_address', addressVisibility: 'address_visibility', mapLocationMode: 'map_location_mode', latitude: 'latitude', longitude: 'longitude', deadline: 'deadline', fulfillmentMode: 'fulfillment_mode', status: 'status' }
    const { assignments, values } = buildUpdate(allowed, normalizedInput)
    if (!assignments.length) return invalid(['buyRequest'])
    const client = await pool.connect()
    let committed = false
    try {
    await client.query('BEGIN')
    const current = await client.query('SELECT status, fulfilled_quantity FROM buy_requests WHERE id = $1 AND buyer_id = $2 FOR UPDATE', [id, user.id])
    if (!current.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    if (input.fulfillmentMode !== undefined && Boolean((await client.query("SELECT 1 FROM orders WHERE buy_request_id = $1 AND status IN ('accepted', 'selected', 'in_progress', 'buyer_marked_completed', 'seller_marked_completed', 'disputed', 'completed') LIMIT 1", [id])).rowCount)) return { status: 409, body: { error: 'FULFILLMENT_MODE_LOCKED' } }
    if (input.categoryId !== undefined && !(await categoryExists(client, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE' } }
    const immutableAfterOffers = ['categoryId', 'productId', 'quantity', 'unit', 'currency']
    const hasOffers = Boolean((await client.query('SELECT 1 FROM offers WHERE buy_request_id = $1 LIMIT 1', [id])).rowCount)
    if (hasOffers && Object.keys(normalizedInput).some((key) => key in allowed && immutableAfterOffers.includes(key))) return { status: 409, body: { error: 'REQUEST_TERMS_LOCKED' } }
    if (input.status !== undefined && !['cancelled', 'expired'].includes(String(input.status))) return { status: 409, body: { error: 'REQUEST_STATUS_MANAGED_BY_DEALS' } }
    const { idParam, ownerParam } = withOwnerConditions(values, id, user.id)
    const result = await client.query(`UPDATE buy_requests SET ${assignments.join(', ')}, closed_at = CASE WHEN status = 'cancelled' THEN now() ELSE closed_at END, updated_at = now() WHERE id = ${idParam} AND buyer_id = ${ownerParam} AND status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled') RETURNING id`, values)
    if (!result.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    if (input.status === 'cancelled' || input.status === 'expired') {
        await client.query('UPDATE buy_requests SET closed_at = now() WHERE id = $1', [id])
        await client.query("UPDATE negotiation_proposals SET status = 'expired', responded_at = now() WHERE offer_id IN (SELECT id FROM offers WHERE buy_request_id = $1) AND status = 'pending'", [id])
    }
    await client.query('COMMIT'); committed = true
    return getBuyRequest(id, user)
    } finally { if (!committed) await client.query('ROLLBACK'); client.release() }
}

export const listOffers = async (user: AuthUser, requestId: string) => {
    const request = await pool.query('SELECT buyer_id FROM buy_requests WHERE id = $1', [requestId])
    if (!request.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    const isBuyer = request.rows[0].buyer_id === user.id
    const isSeller = Boolean((await pool.query('SELECT 1 FROM offers WHERE buy_request_id = $1 AND seller_id = $2', [requestId, user.id])).rowCount)
    if (!isBuyer && !isSeller) return { status: 403, body: { error: 'FORBIDDEN' } }
    const result = await pool.query(`${offerSelect} WHERE o.buy_request_id = $1 ${isBuyer ? '' : 'AND o.seller_id = $2'} ORDER BY o.created_at`, isBuyer ? [requestId] : [requestId, user.id])
    return { status: 200, body: { offers: result.rows.map(offerDto) } }
}

export const listMyOffers = async (user: AuthUser) => {
    const result = await pool.query(`${offerSelect} WHERE o.seller_id = $1 ORDER BY o.updated_at DESC LIMIT 100`, [user.id])
    return { status: 200, body: { offers: result.rows.map(offerDto) } }
}

export const recordOfferView = async (user: AuthUser, offerId: string) => {
    const found = await pool.query('SELECT o.id FROM offers o JOIN buy_requests r ON r.id=o.buy_request_id WHERE o.id=$1 AND (o.seller_id=$2 OR r.buyer_id=$2)',[offerId,user.id])
    if (!found.rowCount) return { status: 404, body: { error: 'OFFER_NOT_FOUND' } }
    await pool.query(`INSERT INTO audit_logs (actor_id,action,entity_type,entity_id)
        SELECT $1,'OFFER_VIEWED','offer',$2 WHERE NOT EXISTS (SELECT 1 FROM audit_logs WHERE actor_id=$1 AND entity_id=$2 AND action='OFFER_VIEWED' AND created_at > now()-interval '5 minutes')`,[user.id,offerId])
    return { status: 204, body: null }
}

export const createOffer = async (user: AuthUser, requestId: string, input: Record<string, unknown>) => {
    const errors = validateOfferInput(input)
    if (errors.length) return invalid(errors)
    const client = await pool.connect()
    let committed = false
    try {
    await client.query('BEGIN')
    const request = await client.query('SELECT buyer_id, category_id, requested_quantity, unit, currency, status, deadline FROM buy_requests WHERE id = $1 FOR UPDATE', [requestId])
    if (!request.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    if (request.rows[0].deadline && request.rows[0].deadline <= new Date()) return { status: 409, body: { error: 'BUY_REQUEST_CLOSED' } }
    if (request.rows[0].buyer_id === user.id) return { status: 403, body: { error: 'BUYER_CANNOT_OFFER' } }
    if (await usersAreBlocked(client, request.rows[0].buyer_id, user.id)) return { status: 403, body: { error: 'USER_BLOCKED' } }
    if (!['open', 'partially_selected', 'partially_completed', 'partially_fulfilled'].includes(request.rows[0].status)) return { status: 409, body: { error: 'BUY_REQUEST_CLOSED' } }
    if (input.unit !== request.rows[0].unit || input.currency !== request.rows[0].currency) return invalid(['unit', 'currency'])
    if (input.productId !== undefined && input.productId !== null) {
        const product = await client.query('SELECT 1 FROM products WHERE id = $1 AND owner_id = $2 AND status = $3 AND category_id = $4 AND quantity > reserved_quantity', [input.productId, user.id, 'active', request.rows[0].category_id])
        if (!product.rowCount) return { status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE' } }
    }
    const terms = { note: input.note ?? '', additionalPhotoUrl: input.additionalPhotoUrl ?? null, availableAt: input.availableAt ?? '' }
    const created = await client.query<{ id: string }>(
        'INSERT INTO offers (buy_request_id, seller_id, product_id, offered_quantity, unit, unit_price, currency, delivery, note, additional_photo_url, terms, delivery_terms, valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
        [requestId, user.id, input.productId ?? null, input.quantity, input.unit, input.price, input.currency, input.delivery, input.note ?? '', input.additionalPhotoUrl ?? null, JSON.stringify(terms), JSON.stringify({ delivery: input.delivery, price: input.deliveryPrice ?? 0 }), input.validUntil ?? null],
    )
    const result = await client.query(`${offerSelect} WHERE o.id = $1`, [created.rows[0].id])
    await createNotification(client, request.rows[0].buyer_id, 'order', 'Нова пропозиція', 'Продавець відповів на ваш запит')
    await audit(client, user.id, 'offer.created', 'offer', created.rows[0].id, { requestId })
    await client.query('COMMIT'); committed = true
    return { status: 201, body: { offer: offerDto(result.rows[0]) } }
    } finally { if (!committed) await client.query('ROLLBACK'); client.release() }
}

export const acceptOffer = async (user: AuthUser, offerId: string, input: Record<string, unknown>) => {
    const requestedQuantity = input.quantity
    if (input.selectionKey !== undefined && !uuid(input.selectionKey)) return invalid(['selectionKey'])
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const linked = (await client.query('SELECT buy_request_id FROM offers WHERE id = $1', [offerId])).rows[0]
        if (!linked) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'OFFER_NOT_FOUND' } } }
        const request = await client.query('SELECT * FROM buy_requests WHERE id = $1 FOR UPDATE', [linked.buy_request_id])
        const offer = await client.query('SELECT o.*, u.username AS seller_username FROM offers o JOIN users u ON u.id = o.seller_id WHERE o.id = $1 FOR UPDATE OF o', [offerId])
        if (!offer.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'OFFER_NOT_FOUND' } } }
        if (!request.rowCount || request.rows[0].buyer_id !== user.id) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'FORBIDDEN' } } }
        const row = offer.rows[0]
        if (input.selectionKey) {
            const previous = (await client.query('SELECT id, offer_id, quantity, subtotal, status FROM orders WHERE buyer_id = $1 AND selection_key = $2', [user.id, input.selectionKey])).rows[0]
            if (previous) {
                await client.query('COMMIT')
                if (previous.offer_id !== offerId || (requestedQuantity !== undefined && Number(previous.quantity) !== requestedQuantity)) return { status: 409, body: { error: 'SELECTION_KEY_REUSED' } }
                return { status: 200, body: { order: { id: previous.id, status: previous.status, quantity: Number(previous.quantity), subtotal: Number(previous.subtotal) } } }
            }
        }
        if (request.rows[0].deadline && request.rows[0].deadline <= new Date()) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'BUY_REQUEST_CLOSED', message: 'Строк запиту вже минув.' } } }
        if (request.rows[0].fulfillment_mode !== 'single_seller' && (typeof requestedQuantity !== 'number' || !Number.isFinite(requestedQuantity) || requestedQuantity <= 0)) { await client.query('ROLLBACK'); return invalid(['quantity']) }
        const selectionQuantity = request.rows[0].fulfillment_mode === 'single_seller'
            ? Number(request.rows[0].requested_quantity) - Number(request.rows[0].selected_quantity) - Number(request.rows[0].completed_quantity)
            : requestedQuantity as number
        if (selectionQuantity <= 0 || Math.abs(selectionQuantity * 1000 - Math.round(selectionQuantity * 1000)) > 0.00001) { await client.query('ROLLBACK'); return invalid(['quantity']) }
        const acceptance = validateAcceptance(row, request.rows[0], selectionQuantity)
        if (!acceptance.ok) { await client.query('ROLLBACK'); return { ...acceptance, body: { ...acceptance.body, remainingQuantity: Number(request.rows[0].requested_quantity) - Number(request.rows[0].selected_quantity) - Number(request.rows[0].completed_quantity), message: 'Залишок або доступність пропозиції змінилися. Оновіть умови перед вибором.' } } }
        const negotiated = (await client.query("SELECT * FROM negotiation_proposals WHERE offer_id = $1 AND status = 'accepted' ORDER BY created_at DESC, id DESC LIMIT 1", [offerId])).rows[0]
        const agreed = negotiated?.status === 'accepted' ? negotiated : null
        if ((input.negotiationProposalId !== undefined && input.negotiationProposalId !== (agreed?.id ?? null)) || (agreed && Number(agreed.quantity) !== selectionQuantity) || (input.expectedPrice !== undefined && Number(agreed?.unit_price ?? row.unit_price) !== input.expectedPrice)) {
            await client.query('ROLLBACK'); return { status: 409, body: { error: 'TERMS_CHANGED', message: 'Умови змінилися. Перегляньте погоджену ціну й кількість перед вибором.' } }
        }
        const unitPrice = Number(agreed?.unit_price ?? row.unit_price)
        const delivery = agreed ? { delivery: agreed.delivery, price: Number(agreed.delivery_price) } : { delivery: row.delivery, price: Number(row.delivery_terms?.price ?? 0) }
        if ((input.expectedDelivery !== undefined && input.expectedDelivery !== delivery.delivery) || (input.expectedDeliveryPrice !== undefined && input.expectedDeliveryPrice !== delivery.price)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'TERMS_CHANGED', message: 'Умови доставки змінилися. Перегляньте новий підсумок.' } } }
        if (await usersAreBlocked(client, user.id, row.seller_id)) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'USER_BLOCKED' } } }
        if (request.rows[0].fulfillment_mode === 'single_seller' && Number(request.rows[0].selected_quantity) > 0) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'REQUEST_ALREADY_ALLOCATED' } } }
        const accepted = Number(row.accepted_quantity) + selectionQuantity
        const offerStatus = accepted === Number(row.offered_quantity) ? 'accepted' : 'partially_accepted'
        if (row.product_id) {
            const stock = await client.query('UPDATE products SET reserved_quantity = reserved_quantity + $1, updated_at = now() WHERE id = $2 AND status = $3 AND quantity - reserved_quantity >= $1 RETURNING id', [selectionQuantity, row.product_id, 'active'])
            if (!stock.rowCount) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'PRODUCT_STOCK_UNAVAILABLE' } } }
        }
        await client.query('UPDATE offers SET accepted_quantity = $1, status = $2, updated_at = now() WHERE id = $3', [accepted, offerStatus, offerId])
        const product = row.product_id ? await client.query<{ title: string }>('SELECT title FROM products WHERE id = $1', [row.product_id]) : { rows: [] as { title: string }[] }
        const goodsTotal = Math.round(selectionQuantity * unitPrice * 100) / 100
        const subtotal = goodsTotal + delivery.price
        const title = product.rows[0]?.title ?? request.rows[0].title
        const order = await client.query<{ id: string }>('INSERT INTO orders (buy_request_id, offer_id, buyer_id, seller_id, status, currency, subtotal, quantity, unit, unit_price, conditions_snapshot, selection_key, negotiation_proposal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id', [row.buy_request_id, row.id, user.id, row.seller_id, 'selected', row.currency, subtotal, selectionQuantity, row.unit, unitPrice, JSON.stringify({ offerId: row.id, productTitle: title, originalOffer: { price: Number(row.unit_price), quantity: Number(row.offered_quantity), delivery: row.delivery, note: row.note }, terms: row.terms, delivery, goodsTotal, grandTotal: subtotal, negotiated: agreed ? { id: agreed.id, price: unitPrice, quantity: selectionQuantity, delivery } : null }), input.selectionKey ?? null, agreed?.id ?? null])
        await client.query('INSERT INTO order_items (order_id, offer_id, product_id, quantity, unit, unit_price, currency, product_title_snapshot, offer_terms_snapshot, delivery_terms_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [order.rows[0].id, row.id, row.product_id, selectionQuantity, row.unit, unitPrice, row.currency, title, row.terms, JSON.stringify(delivery)])
        await createOrderConversation(client, order.rows[0].id, user.id, row.seller_id, row.id)
        await refreshRequestQuantities(client, row.buy_request_id)
        await audit(client, user.id, 'offer.selected', 'offer', offerId, { quantity: selectionQuantity, orderId: order.rows[0].id })
        await audit(client, user.id, 'OFFER_SELECTED', 'order', order.rows[0].id, { offerId, requestId: row.buy_request_id })
        await audit(client, user.id, 'SELLER_CONFIRMATION_REQUESTED', 'order', order.rows[0].id)
        await client.query('COMMIT')
        return { status: 201, body: { order: { id: order.rows[0].id, buyRequestId: row.buy_request_id, sellerId: row.seller_id, quantity: selectionQuantity, subtotal, status: 'selected' } } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}

export const updateOffer = async (user: AuthUser, offerId: string, input: Record<string, unknown>) => {
    const errors = validateOfferInput(input, true)
    if (errors.length) return invalid(errors)
    const allowed: Record<string, string> = { productId: 'product_id', quantity: 'offered_quantity', unit: 'unit', price: 'unit_price', currency: 'currency', delivery: 'delivery', note: 'note', additionalPhotoUrl: 'additional_photo_url', validUntil: 'valid_until' }
    const { assignments, values } = buildUpdate(allowed, input)
    if (input.deliveryPrice !== undefined) assignments.push(`delivery_terms = delivery_terms || jsonb_build_object('price', $${values.push(input.deliveryPrice)}::numeric)`)
    if (input.availableAt !== undefined) assignments.push(`terms = terms || jsonb_build_object('availableAt', $${values.push(input.availableAt)}::text)`)
    if (!assignments.length) return invalid(['offer'])
    const client = await pool.connect()
    let committed = false
    try {
        await client.query('BEGIN')
        const link = (await client.query('SELECT buy_request_id FROM offers WHERE id = $1 AND seller_id = $2', [offerId, user.id])).rows[0]
        if (!link) return { status: 404, body: { error: 'OFFER_NOT_FOUND' } }
        const request = (await client.query('SELECT * FROM buy_requests WHERE id = $1 FOR UPDATE', [link.buy_request_id])).rows[0]
        const existing = (await client.query('SELECT * FROM offers WHERE id = $1 FOR UPDATE', [offerId])).rows[0]
        if (existing.status !== 'submitted' || Number(existing.accepted_quantity) > 0) return { status: 409, body: { error: 'OFFER_TERMS_LOCKED' } }
        if ((input.unit !== undefined && input.unit !== request.unit) || (input.currency !== undefined && input.currency !== request.currency)) return invalid(['unit','currency'])
        if (input.productId) {
            const product = await client.query("SELECT id FROM products WHERE id=$1 AND owner_id=$2 AND category_id=$3 AND status='active' AND quantity > reserved_quantity", [input.productId, user.id, request.category_id])
            if (!product.rowCount) return { status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE' } }
        }
        const { idParam, ownerParam } = withOwnerConditions(values, offerId, user.id)
        await client.query(`UPDATE offers SET ${assignments.join(', ')}, updated_at = now() WHERE id = ${idParam} AND seller_id = ${ownerParam}`, values)
        await client.query(`UPDATE offers SET terms = terms || jsonb_build_object('note', note, 'additionalPhotoUrl', additional_photo_url), delivery_terms = delivery_terms || jsonb_build_object('delivery', delivery) WHERE id=$1`, [offerId])
        const conversation = (await client.query('SELECT id FROM conversations WHERE offer_id=$1',[offerId])).rows[0]
        if (conversation) {
            const text = input.price !== undefined ? `Продавець змінив ціну пропозиції: ${existing.unit_price} → ${input.price} ${existing.currency}. Погоджені раніше умови залишаються в історії.` : 'Продавець оновив пропозицію. Перегляньте актуальні умови.'
            await client.query("INSERT INTO messages (conversation_id,sender_id,body,kind) VALUES ($1,$2,$3,'system')", [conversation.id,user.id,text])
            await createNotification(client, request.buyer_id, 'order', 'Пропозицію оновлено', text, null, conversation.id)
        }
        const result = await client.query(`${offerSelect} WHERE o.id = $1`, [offerId])
        await audit(client, user.id, 'offer.updated', 'offer', offerId)
        await client.query('COMMIT'); committed = true
        return { status: 200, body: { offer: offerDto(result.rows[0]) } }
    } finally { if (!committed) await client.query('ROLLBACK'); client.release() }
}

export const withdrawOffer = async (user: AuthUser, offerId: string) => {
    const client = await pool.connect()
    let committed = false
    try {
        await client.query('BEGIN')
        const link = (await client.query('SELECT buy_request_id FROM offers WHERE id=$1 AND seller_id=$2',[offerId,user.id])).rows[0]
        if (!link) return { status: 404, body: { error: 'OFFER_NOT_FOUND' } }
        const request = (await client.query('SELECT buyer_id FROM buy_requests WHERE id=$1 FOR UPDATE',[link.buy_request_id])).rows[0]
        const result = await client.query(`UPDATE offers SET status = 'withdrawn', updated_at = now() WHERE id = $1 AND seller_id = $2 AND status IN ('submitted','partially_accepted','accepted') RETURNING id`, [offerId, user.id])
        if (!result.rowCount) return { status: 409, body: { error: 'OFFER_CANNOT_BE_WITHDRAWN' } }
        await client.query("UPDATE negotiation_proposals SET status='expired', responded_at=now() WHERE offer_id=$1 AND status='pending'",[offerId])
        const conversation = (await client.query('SELECT id FROM conversations WHERE offer_id=$1',[offerId])).rows[0]
        if (conversation) await client.query("INSERT INTO messages (conversation_id,sender_id,body,kind) VALUES ($1,$2,'Продавець відкликав пропозицію. Створені домовленості залишаються чинними.','system')",[conversation.id,user.id])
        await createNotification(client,request.buyer_id,'order','Пропозицію відкликано','Створені домовленості залишаються чинними.',null,conversation?.id ?? null)
        await audit(client, user.id, 'offer.withdrawn', 'offer', offerId)
        await client.query('COMMIT'); committed = true
        return { status: 204, body: null }
    } finally { if (!committed) await client.query('ROLLBACK'); client.release() }
}

export const rejectOffer = async (user: AuthUser, offerId: string) => {
    const offer = await pool.query(`SELECT o.buy_request_id, r.buyer_id FROM offers o JOIN buy_requests r ON r.id = o.buy_request_id WHERE o.id = $1 FOR UPDATE OF o`, [offerId])
    if (!offer.rowCount) return { status: 404, body: { error: 'OFFER_NOT_FOUND' } }
    if (offer.rows[0].buyer_id !== user.id) return { status: 403, body: { error: 'FORBIDDEN' } }
    const result = await pool.query(`UPDATE offers SET status = 'rejected', updated_at = now() WHERE id = $1 AND status IN ('submitted', 'partially_accepted') AND accepted_quantity = 0 RETURNING seller_id`, [offerId])
    if (!result.rowCount) return { status: 409, body: { error: 'OFFER_CANNOT_BE_REJECTED' } }
    await createNotification(pool, result.rows[0].seller_id, 'order', 'Пропозицію відхилено', 'Покупець відхилив вашу пропозицію')
    await audit(pool, user.id, 'offer.rejected', 'offer', offerId)
    return { status: 204, body: null }
}
