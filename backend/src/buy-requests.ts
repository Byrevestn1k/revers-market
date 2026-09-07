import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { validateBuyRequestInput, validateOfferInput } from './buy-request-validation.js'
import { approximatePoint } from './map-service.js'

type Queryable = Pick<PoolClient, 'query'>
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const number = (value: string | number | null) => value === null ? null : Number(value)
const invalid = (fields: string[]) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте дані запиту', fields } })

const requestSelect = `SELECT r.*, c.code AS category_code, c.name AS category_name, u.username AS buyer_username
    FROM buy_requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.buyer_id`
const offerSelect = `SELECT o.*, u.username AS seller_username, p.title AS product_title
    FROM offers o JOIN users u ON u.id = o.seller_id LEFT JOIN products p ON p.id = o.product_id`

const requestDto = (row: any, includeAddress = false) => ({
    id: row.id, buyer: { id: row.buyer_id, username: row.buyer_username },
    category: { id: row.category_id, code: row.category_code, name: row.category_name },
    productId: row.product_id, title: row.title, description: row.description,
    quantity: Number(row.requested_quantity), fulfilledQuantity: Number(row.fulfilled_quantity), unit: row.unit,
    price: { min: number(row.min_unit_price), max: number(row.max_unit_price), currency: row.currency },
    delivery: { required: row.delivery_required, preferred: row.preferred_delivery, address: includeAddress ? row.delivery_address : null },
    geoArea: row.geo_area, coordinates: row.latitude === null || row.longitude === null ? null : approximatePoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }), deadline: row.deadline?.toISOString() ?? null, status: row.status,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
})
const offerDto = (row: any) => ({
    id: row.id, seller: { id: row.seller_id, username: row.seller_username }, buyRequestId: row.buy_request_id,
    existingProduct: row.product_id ? { id: row.product_id, title: row.product_title } : null,
    quantity: Number(row.offered_quantity), acceptedQuantity: Number(row.accepted_quantity), unit: row.unit,
    price: { amount: Number(row.unit_price), currency: row.currency }, delivery: row.delivery, note: row.note,
    additionalPhotoUrl: row.additional_photo_url, termsSnapshot: row.terms, deliverySnapshot: row.delivery_terms,
    status: row.status, validUntil: row.valid_until?.toISOString() ?? null, createdAt: row.created_at.toISOString(),
})

const categoryExists = async (queryable: Queryable, id: string) => Boolean((await queryable.query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [id])).rowCount)

export const createBuyRequest = async (user: AuthUser, input: Record<string, unknown>) => {
    const errors = validateBuyRequestInput(input)
    if (errors.length) return invalid(errors)
    if (!(await categoryExists(pool, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE' } }
    const exactPrice = input.exactPrice ?? null
    const deliveryRequired = input.delivery === 'yes' || input.delivery === 'preferred' || input.deliveryRequired === true
    const preferredDelivery = input.preferredDelivery ?? (input.delivery === 'preferred' ? 'preferred' : null)
    const created = await pool.query<{ id: string }>(
        'INSERT INTO buy_requests (buyer_id, category_id, product_id, title, description, requested_quantity, unit, currency, min_unit_price, max_unit_price, delivery_required, preferred_delivery, geo_area, delivery_address, latitude, longitude, deadline) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id',
        [user.id, input.categoryId, input.productId ?? null, String(input.title).trim(), input.description ?? '', input.quantity, input.unit, input.currency, exactPrice ?? input.minPrice ?? null, exactPrice ?? input.maxPrice ?? null, deliveryRequired, preferredDelivery, String(input.geoArea).trim(), input.address ?? null, input.latitude ?? null, input.longitude ?? null, input.deadline ?? null],
    )
    const response = await getBuyRequest(created.rows[0].id, user)
    return { ...response, status: 201 }
}

export const getBuyRequest = async (id: string, user?: AuthUser) => {
    const result = await pool.query(`${requestSelect} WHERE r.id = $1 AND r.status <> 'cancelled'`, [id])
    if (!result.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    const isOwner = user?.id === result.rows[0].buyer_id
    return { status: 200, body: { buyRequest: requestDto(result.rows[0], isOwner) } }
}

export const listBuyRequests = async (query: Record<string, unknown>, user?: AuthUser) => {
    const params: unknown[] = []
    const conditions = [user && query.mine === 'true' ? `r.buyer_id = $${params.push(user.id)}` : `r.status IN ('open', 'partially_fulfilled')`]
    if (typeof query.categoryId === 'string' && uuid(query.categoryId)) conditions.push(`r.category_id = $${params.push(query.categoryId)}`)
    const result = await pool.query(`${requestSelect} WHERE ${conditions.join(' AND ')} ORDER BY r.created_at DESC LIMIT 50`, params)
    return { status: 200, body: { buyRequests: result.rows.map((row) => requestDto(row, user?.id === row.buyer_id)) } }
}

export const updateBuyRequest = async (user: AuthUser, id: string, input: Record<string, unknown>) => {
    const errors = validateBuyRequestInput(input, true)
    if (errors.length) return invalid(errors)
    const normalizedInput = { ...input }
    if (input.exactPrice !== undefined) { normalizedInput.minPrice = input.exactPrice; normalizedInput.maxPrice = input.exactPrice }
    if (input.delivery !== undefined) { normalizedInput.deliveryRequired = input.delivery !== 'no'; if (input.delivery === 'preferred') normalizedInput.preferredDelivery = input.preferredDelivery ?? 'preferred' }
    const allowed: Record<string, string> = { categoryId: 'category_id', productId: 'product_id', title: 'title', description: 'description', quantity: 'requested_quantity', unit: 'unit', currency: 'currency', minPrice: 'min_unit_price', maxPrice: 'max_unit_price', deliveryRequired: 'delivery_required', preferredDelivery: 'preferred_delivery', geoArea: 'geo_area', address: 'delivery_address', latitude: 'latitude', longitude: 'longitude', deadline: 'deadline', status: 'status' }
    const entries = Object.entries(normalizedInput).filter(([key]) => key in allowed)
    if (!entries.length) return invalid(['buyRequest'])
    const values = entries.map(([, value]) => value)
    const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`)
    values.push(id, user.id)
    const result = await pool.query(`UPDATE buy_requests SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND buyer_id = $${values.length} AND status IN ('open', 'partially_fulfilled') RETURNING id`, values)
    if (!result.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    return getBuyRequest(id, user)
}

export const listOffers = async (user: AuthUser, requestId: string) => {
    const request = await pool.query('SELECT buyer_id FROM buy_requests WHERE id = $1', [requestId])
    if (!request.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    const allowed = request.rows[0].buyer_id === user.id || Boolean((await pool.query('SELECT 1 FROM offers WHERE buy_request_id = $1 AND seller_id = $2', [requestId, user.id])).rowCount)
    if (!allowed) return { status: 403, body: { error: 'FORBIDDEN' } }
    const result = await pool.query(`${offerSelect} WHERE o.buy_request_id = $1 ORDER BY o.created_at`, [requestId])
    return { status: 200, body: { offers: result.rows.map(offerDto) } }
}

export const createOffer = async (user: AuthUser, requestId: string, input: Record<string, unknown>) => {
    const errors = validateOfferInput(input)
    if (errors.length) return invalid(errors)
    const request = await pool.query('SELECT buyer_id, requested_quantity, unit, currency, status FROM buy_requests WHERE id = $1', [requestId])
    if (!request.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    if (request.rows[0].buyer_id === user.id) return { status: 403, body: { error: 'BUYER_CANNOT_OFFER' } }
    if (request.rows[0].status !== 'open' && request.rows[0].status !== 'partially_fulfilled') return { status: 409, body: { error: 'BUY_REQUEST_CLOSED' } }
    if (input.unit !== request.rows[0].unit || input.currency !== request.rows[0].currency) return invalid(['unit', 'currency'])
    if (input.productId !== undefined && input.productId !== null) {
        const product = await pool.query('SELECT 1 FROM products WHERE id = $1 AND owner_id = $2', [input.productId, user.id])
        if (!product.rowCount) return { status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE' } }
    }
    const terms = { note: input.note ?? '', additionalPhotoUrl: input.additionalPhotoUrl ?? null }
    const created = await pool.query<{ id: string }>(
        'INSERT INTO offers (buy_request_id, seller_id, product_id, offered_quantity, unit, unit_price, currency, delivery, note, additional_photo_url, terms, delivery_terms, valid_until) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id',
        [requestId, user.id, input.productId ?? null, input.quantity, input.unit, input.price, input.currency, input.delivery, input.note ?? '', input.additionalPhotoUrl ?? null, JSON.stringify(terms), JSON.stringify({ delivery: input.delivery }), input.validUntil ?? null],
    )
    const result = await pool.query(`${offerSelect} WHERE o.id = $1`, [created.rows[0].id])
    return { status: 201, body: { offer: offerDto(result.rows[0]) } }
}

export const acceptOffer = async (user: AuthUser, offerId: string, input: Record<string, unknown>) => {
    const quantity = input.quantity
    if (typeof quantity !== 'number' || !Number.isFinite(quantity) || quantity <= 0) return invalid(['quantity'])
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const offer = await client.query('SELECT o.*, u.username AS seller_username FROM offers o JOIN users u ON u.id = o.seller_id WHERE o.id = $1 FOR UPDATE', [offerId])
        if (!offer.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'OFFER_NOT_FOUND' } } }
        const request = await client.query('SELECT * FROM buy_requests WHERE id = $1 FOR UPDATE', [offer.rows[0].buy_request_id])
        if (!request.rowCount || request.rows[0].buyer_id !== user.id) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'FORBIDDEN' } } }
        const row = offer.rows[0]
        const remainingOffer = Number(row.offered_quantity) - Number(row.accepted_quantity)
        const remainingRequest = Number(request.rows[0].requested_quantity) - Number(request.rows[0].fulfilled_quantity)
        if (quantity > remainingOffer || quantity > remainingRequest) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'QUANTITY_EXCEEDS_REMAINING' } } }
        const accepted = Number(row.accepted_quantity) + quantity
        const fulfilled = Number(request.rows[0].fulfilled_quantity) + quantity
        const offerStatus = accepted === Number(row.offered_quantity) ? 'accepted' : 'partially_accepted'
        const requestStatus = fulfilled === Number(request.rows[0].requested_quantity) ? 'fulfilled' : 'partially_fulfilled'
        await client.query('UPDATE offers SET accepted_quantity = $1, status = $2, updated_at = now() WHERE id = $3', [accepted, offerStatus, offerId])
        await client.query('UPDATE buy_requests SET fulfilled_quantity = $1, status = $2, updated_at = now() WHERE id = $3', [fulfilled, requestStatus, row.buy_request_id])
        const product = row.product_id ? await client.query<{ title: string }>('SELECT title FROM products WHERE id = $1', [row.product_id]) : { rows: [] as { title: string }[] }
        const subtotal = quantity * Number(row.unit_price)
        const order = await client.query('INSERT INTO orders (buy_request_id, buyer_id, seller_id, currency, subtotal) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (buy_request_id, seller_id) DO UPDATE SET subtotal = orders.subtotal + EXCLUDED.subtotal, updated_at = now() RETURNING id', [row.buy_request_id, user.id, row.seller_id, row.currency, subtotal])
        await client.query('INSERT INTO order_items (order_id, offer_id, product_id, quantity, unit, unit_price, currency, product_title_snapshot, offer_terms_snapshot, delivery_terms_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [order.rows[0].id, row.id, row.product_id, quantity, row.unit, row.unit_price, row.currency, product.rows[0]?.title ?? '', row.terms, row.delivery_terms])
        await client.query('COMMIT')
        return { status: 201, body: { order: { id: order.rows[0].id, buyRequestId: row.buy_request_id, sellerId: row.seller_id, quantity, subtotal, status: 'pending' } } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}