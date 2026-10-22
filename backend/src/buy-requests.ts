import { getSettlement, settlementCodesInRegion } from './settlements.js'
import { regionCondition, settlementCondition } from './map-service.js'
import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { validateBuyRequestInput, validateOfferInput } from './buy-request-validation.js'
import { currencyLabel } from './currency-label.js'
import { approximatePoint } from './map-service.js'
import { createOrderConversation } from './order-service.js'
import { refreshRequestQuantities } from './request-quantities.js'
import { audit, createNotification, usersAreBlocked } from './community-service.js'
import { buildUpdate, withOwnerConditions } from './dynamic-update.js'
import { categoryFilterSql } from './category-filter.js'
import { assessCategory } from './category-recommendation.js'
import { categoryDuplicates } from './category-duplicates.js'
import { textSearchConditions } from './text-search.js'
import { listingSearchColumns, smartSearchSql } from './smart-search.js'
import { notifyDemandSubscriptions } from './demand-subscriptions.js'
import { randomUUID } from 'node:crypto'
import { ExternalUrlPhotoStorage, type PhotoUpload, type StoredPhoto } from './photo-storage.js'
import { matchDelivery, type DeliveryOption, type DeliveryPlace } from './delivery-compatibility.js'
import { verifiedDeliveryOptions, verifiedDeliveryPlace, verifiedInputPoint, verifiedOptionsForMatching } from './delivery-geography.js'
import { isDeepStrictEqual } from 'node:util'

type Queryable = Pick<PoolClient, 'query'>
const uuid = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
const number = (value: string | number | null) => value === null ? null : Number(value)
const invalid = (fields: string[]) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте дані запиту', fields } })
const requestPhotoStorage = new ExternalUrlPhotoStorage('buy-requests')
const offerPhotoStorage = new ExternalUrlPhotoStorage('offers')
// Serialize reference creation with the final reference check and file removal.
const offerPhotoLock = [13, 45]
type RequestPhoto = { url: string; alt: string; storage_key: string }

const saveRequestPhotos = async (client: Queryable, id: string, photos: PhotoUpload[], stored: StoredPhoto[]) => {
    const existing = await client.query<RequestPhoto>('SELECT url, alt, storage_key FROM buy_request_photos WHERE buy_request_id = $1 ORDER BY sort_order, id', [id])
    const retained = new Set(photos.filter((photo) => photo.url).map((photo) => photo.url))
    if (photos.some((photo) => photo.url && !existing.rows.some((old) => old.url === photo.url))) return invalid(['photos'])
    const rows: RequestPhoto[] = []
    for (const [index, photo] of photos.entries()) {
        if (photo.url) {
            const old = existing.rows.find((item) => item.url === photo.url)!
            rows.push({ ...old, alt: photo.alt ?? old.alt })
        } else {
            const saved = await requestPhotoStorage.store(`${id}/${randomUUID()}`, photo, index)
            stored.push(saved)
            rows.push({ url: saved.url, storage_key: saved.storageKey, alt: photo.alt ?? '' })
        }
    }
    await client.query('DELETE FROM buy_request_photos WHERE buy_request_id = $1', [id])
    for (const [index, photo] of rows.entries()) await client.query('INSERT INTO buy_request_photos (buy_request_id, storage_key, url, alt, sort_order) VALUES ($1,$2,$3,$4,$5)', [id, photo.storage_key, photo.url, photo.alt, index])
    return existing.rows.filter((photo) => !retained.has(photo.url)).map((photo) => photo.storage_key)
}

const saveOfferPhotos = async (client: Queryable, id: string, productId: string | null, photos: PhotoUpload[], stored: StoredPhoto[]) => {
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', offerPhotoLock)
    const old = (await client.query<RequestPhoto>('SELECT url, alt, storage_key FROM offer_photos WHERE offer_id=$1 ORDER BY sort_order, id', [id])).rows
    if (productId) await client.query('SELECT 1 FROM products WHERE id=$1 FOR SHARE', [productId])
    const product = productId ? (await client.query<RequestPhoto>('SELECT url, alt, storage_key FROM product_photos WHERE product_id=$1 ORDER BY sort_order, id', [productId])).rows : []
    const rows: RequestPhoto[] = []
    for (const [index, photo] of photos.entries()) {
        const previous = old.find(item => item.url === photo.url)
        if (previous) { rows.push({ ...previous, alt: photo.alt ?? previous.alt }); continue }
        const source = product.find(item => item.url === photo.url)
        if (photo.url && !source) return invalid(['photos'])
        const saved = source
            ? await offerPhotoStorage.copyProductPhoto(id, source.url)
            : await offerPhotoStorage.store(`${id}/${randomUUID()}`, photo, index)
        stored.push(saved)
        rows.push({ url: saved.url, storage_key: saved.storageKey, alt: photo.alt ?? source?.alt ?? '' })
    }
    await client.query('DELETE FROM offer_photos WHERE offer_id=$1', [id])
    for (const [index, photo] of rows.entries()) await client.query('INSERT INTO offer_photos (offer_id, storage_key, url, alt, sort_order) VALUES ($1,$2,$3,$4,$5)', [id, photo.storage_key, photo.url, photo.alt, index])
    return old.filter(photo => !rows.some(current => current.storage_key === photo.storage_key)).map(photo => photo.storage_key)
}

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

const requestSelect = `SELECT count(*) OVER() AS total_count, r.*, c.code AS category_code, c.name AS category_name, c.image_index AS category_image_index, u.username AS buyer_username,
    (SELECT count(*)::int FROM offers ro WHERE ro.buy_request_id = r.id) AS offer_count,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('url', rp.url, 'alt', rp.alt) ORDER BY rp.sort_order, rp.id) FROM buy_request_photos rp WHERE rp.buy_request_id = r.id), '[]'::jsonb) AS photos
    FROM buy_requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.buyer_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id`
const offerSelect = `SELECT o.*, u.username AS seller_username, p.title AS product_title, r.title AS request_title, r.description AS request_description,
    r.category_id, r.requested_quantity AS request_quantity, r.unit AS request_unit, r.min_unit_price AS request_min_price, r.max_unit_price AS request_max_price,
    r.preferred_delivery AS request_delivery, r.receipt_method AS request_receipt_method, r.delivery_options AS request_delivery_options,
    r.settlement_code AS request_settlement_code, r.latitude AS request_latitude, r.longitude AS request_longitude, r.address_visibility AS request_address_visibility,
    p.settlement_code AS product_settlement_code, p.latitude AS product_latitude, p.longitude AS product_longitude, p.address_visibility AS product_address_visibility,
    r.status AS request_status,
    c.name AS request_category_name, c.image_index AS request_category_image_index,
    CASE WHEN u.rating_count > 0 THEN round(u.rating_sum / u.rating_count, 2) ELSE NULL END AS seller_rating,
    u.avatar_url AS seller_avatar,
    COALESCE((SELECT jsonb_agg(jsonb_build_object('url', op.url, 'alt', op.alt) ORDER BY op.sort_order, op.id) FROM offer_photos op WHERE op.offer_id = o.id),
        CASE WHEN o.creation_mode IS NULL THEN (SELECT jsonb_agg(jsonb_build_object('url', pp.url, 'alt', pp.alt) ORDER BY pp.sort_order, pp.id) FROM product_photos pp WHERE pp.product_id = o.product_id) ELSE NULL END,
        '[]'::jsonb) AS offer_photos,
    EXISTS (SELECT 1 FROM negotiation_proposals np WHERE np.offer_id = o.id AND np.status = 'pending' AND np.created_by <> o.seller_id) AS pending_negotiation,
    EXISTS (SELECT 1 FROM orders so WHERE so.offer_id = o.id AND so.status = 'selected') AS waiting_confirmation,
    (SELECT count(*)::int FROM orders d WHERE (d.seller_id = u.id OR d.buyer_id = u.id) AND d.status = 'completed' AND d.buyer_completed_at IS NOT NULL AND d.seller_completed_at IS NOT NULL) AS seller_deals
    FROM offers o JOIN users u ON u.id = o.seller_id JOIN buy_requests r ON r.id = o.buy_request_id JOIN categories c ON c.id = r.category_id LEFT JOIN products p ON p.id = o.product_id`

interface BuyRequestRow {
    delivery_options: import('./delivery-compatibility.js').DeliveryOption[] | null
    country_code: string | null
    receipt_method: 'SELF_PICKUP' | 'SELLER_DELIVERY' | null
    settlement_code?: string | null
    id: string
    buyer_id: string
    buyer_username: string
    offer_count: number
    photos: { url: string; alt: string }[]
    category_id: string
    category_code: string
    category_name: string
    category_image_index: number | null
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
    delivery_options: import('./delivery-compatibility.js').DeliveryOption[] | null
    offer_photos?: { url: string; alt: string }[]
    title: string | null
    description: string
    characteristics: string
    creation_mode: string | null
    request_description: string
    request_quantity: string | number
    request_unit: string
    request_min_price: string | number | null
    request_max_price: string | number | null
    request_delivery: string | null
    request_receipt_method: string | null
    request_delivery_options: DeliveryOption[] | null
    request_settlement_code: string | null
    request_latitude: number | string | null
    request_longitude: number | string | null
    request_address_visibility: 'private' | 'public'
    product_settlement_code: string | null
    product_latitude: number | string | null
    product_longitude: number | string | null
    product_address_visibility: 'private' | 'public' | null
    category_id: string
    request_category_name: string
    request_category_image_index: number | null
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
    request_title: string
    request_status: string
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
    updated_at: Date
}

const requestDto = (row: BuyRequestRow, includeAddress = false) => ({
    id: row.id, buyer: { id: row.buyer_id, username: row.buyer_username }, ...(includeAddress ? { offerCount: row.offer_count } : {}),
    category: { id: row.category_id, code: row.category_code, name: row.category_name, imageIndex: row.category_image_index },
    productId: row.product_id, title: row.title, description: row.description, photos: row.photos ?? [],
    quantity: Number(row.requested_quantity), fulfilledQuantity: Number(row.fulfilled_quantity), selectedQuantity: Number(row.selected_quantity ?? 0), completedQuantity: Number(row.completed_quantity ?? row.fulfilled_quantity), remainingQuantity: Number(row.requested_quantity) - Number(row.selected_quantity ?? 0) - Number(row.completed_quantity ?? row.fulfilled_quantity), fulfillmentMode: row.fulfillment_mode, unit: row.unit,
    price: { min: number(row.min_unit_price), max: number(row.max_unit_price), currency: row.currency },
    delivery: { required: row.delivery_required, preferred: row.preferred_delivery, address: includeAddress || row.address_visibility === 'public' ? row.delivery_address : null },
    addressVisibility: row.address_visibility,
    countryCode: row.country_code, receiptMethod: row.receipt_method, deliveryOptions: row.delivery_options,
    mapLocationMode: row.map_location_mode,
    geoArea: row.geo_area, settlement: getSettlement(row.settlement_code), coordinates: row.latitude === null || row.longitude === null ? null : includeAddress || row.address_visibility === 'public' ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : approximatePoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }), deadline: row.deadline?.toISOString() ?? null, status: row.status,
    createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
})
const deliveryPlace = (code: string | null, latitude: number | string | null, longitude: number | string | null, visibility: 'private' | 'public' | null): DeliveryPlace => ({
    settlementCode: code, region: getSettlement(code)?.region ?? null,
    publicPoint: latitude === null || longitude === null ? null : visibility === 'public' ? { latitude: Number(latitude), longitude: Number(longitude) } : approximatePoint({ latitude: Number(latitude), longitude: Number(longitude) }),
})
const offerDto = async (row: OfferRow) => ({
    id: row.id, seller: { id: row.seller_id, username: row.seller_username, rating: row.seller_rating == null ? null : Number(row.seller_rating), avatarUrl: row.seller_avatar, completedDeals: row.seller_deals ?? 0 }, buyRequestId: row.buy_request_id, requestTitle: row.request_title, requestStatus: row.request_status,
    existingProduct: row.product_id ? { id: row.product_id, title: row.product_title } : null,
    title: row.title ?? row.product_title ?? row.request_title, description: row.description, characteristics: row.characteristics, creationMode: row.creation_mode,
    request: { title: row.request_title, description: row.request_description, quantity: Number(row.request_quantity), unit: row.request_unit, minPrice: number(row.request_min_price), maxPrice: number(row.request_max_price), delivery: row.request_delivery, receiptMethod: row.request_receipt_method, deliveryOptions: row.request_delivery_options, category: { id: row.category_id, name: row.request_category_name, imageIndex: row.request_category_image_index, parentId: null } },
    quantity: Number(row.offered_quantity), acceptedQuantity: Number(row.accepted_quantity), unit: row.unit,
    price: { amount: Number(row.unit_price), currency: row.currency }, delivery: row.delivery, deliveryOptions: row.delivery_options, note: row.note,
    deliveryCompatibility: matchDelivery(
        { options: row.request_delivery_options, place: await verifiedDeliveryPlace(deliveryPlace(row.request_settlement_code, row.request_latitude, row.request_longitude, row.request_address_visibility)) },
        { options: await verifiedOptionsForMatching(row.delivery_options), place: await verifiedDeliveryPlace(deliveryPlace(row.product_settlement_code, row.product_latitude, row.product_longitude, row.product_address_visibility)) },
    ),
    additionalPhotoUrl: row.additional_photo_url, termsSnapshot: row.terms, deliverySnapshot: row.delivery_terms,
    photos: row.offer_photos ?? [], pendingNegotiation: row.pending_negotiation, waitingConfirmation: row.waiting_confirmation,
    status: row.status, validUntil: row.valid_until?.toISOString() ?? null, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(),
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
    if (quantity > remainingOffer || quantity > remainingRequest) return { ok: false, status: 409, body: { error: 'QUANTITY_EXCEEDS_REMAINING' } }
    return { ok: true }
}

export const createBuyRequest = async (user: AuthUser, input: Record<string, unknown>) => {
    const errors = validateBuyRequestInput(input)
    if (errors.length) return invalid(errors)
    if (Array.isArray(input.photos) && input.photos.some((photo: PhotoUpload) => photo.url)) return invalid(['photos'])
    if (!(await categoryExists(pool, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE' } }
    const assessment = await assessCategory({ title: String(input.title), description: String(input.description ?? ''), categoryId: String(input.categoryId), unit: String(input.unit) })
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
    if (!await verifiedInputPoint({ settlementCode: input.settlementCode, label: input.geoArea, countryCode: input.countryCode ?? 'UA', latitude, longitude })) return invalid(['latitude', 'longitude'])
    const deliveryRequired = input.receiptMethod != null ? input.receiptMethod === 'SELLER_DELIVERY' : input.delivery === 'yes' || input.delivery === 'preferred' || input.deliveryRequired === true
    const preferredDelivery = input.receiptMethod != null ? input.receiptMethod === 'SELF_PICKUP' ? 'pickup' : 'seller_delivery' : input.preferredDelivery ?? (input.delivery === 'preferred' ? 'preferred' : null)
    const receiptMethod = input.receiptMethod ?? (preferredDelivery === 'pickup' && !deliveryRequired ? 'SELF_PICKUP' : preferredDelivery === 'seller_delivery' ? 'SELLER_DELIVERY' : null)
    const client = await pool.connect()
    let requestId: string
    let duplicateNotice: Awaited<ReturnType<typeof categoryDuplicates>>['notice'] = null
    const storedPhotos: StoredPhoto[] = []
    try {
    await client.query('BEGIN')
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id])
    const duplicates = await categoryDuplicates(client, 'buy_request', user.id, String(input.title), String(input.description ?? ''), String(input.categoryId))
    duplicateNotice = duplicates.notice
    if (duplicates.massAbuse) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'CATEGORY_DUPLICATE_ABUSE', message: 'Однаковий запит уже розміщено в кількох категоріях.', duplicate: duplicates.notice } } }
    const created = await client.query<{ id: string }>(
        'INSERT INTO buy_requests (buyer_id, category_id, product_id, title, description, requested_quantity, unit, currency, min_unit_price, max_unit_price, delivery_required, preferred_delivery, geo_area, delivery_address, latitude, longitude, deadline, settlement_code, address_visibility, map_location_mode, fulfillment_mode, country_code, receipt_method, delivery_options) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24) RETURNING id',
        [user.id, input.categoryId, input.productId ?? null, String(input.title).trim(), input.description ?? '', input.quantity, input.unit, input.currency, exactPrice ?? minPrice, exactPrice ?? maxPrice, deliveryRequired, preferredDelivery, String(input.geoArea).trim(), input.address ?? null, latitude, longitude, deadline, input.settlementCode ?? null, input.addressVisibility ?? 'private', input.mapLocationMode ?? 'profile', input.fulfillmentMode ?? 'single_seller', input.countryCode ?? 'UA', receiptMethod, input.deliveryOptions === undefined ? null : JSON.stringify(input.deliveryOptions)],
    )
    requestId = created.rows[0].id
    if (assessment.level === 'warn') await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_warning', 'buy_request', requestId, JSON.stringify({ suggestions: assessment.suggestions })])
    if (duplicates.notice) await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_duplicate', 'buy_request', requestId, JSON.stringify(duplicates.notice)])
    if (Array.isArray(input.photos)) await saveRequestPhotos(client, requestId, input.photos as PhotoUpload[], storedPhotos)
    await notifyDemandSubscriptions(client, requestId)
    await client.query('COMMIT')
    } catch (error) {
        await client.query('ROLLBACK')
        for (const photo of storedPhotos) await requestPhotoStorage.remove(photo.storageKey)
        throw error
    } finally { client.release() }
    const response = await getBuyRequest(requestId, user)
    return { ...response, status: 201, body: { ...response.body, ...(assessment.level === 'warn' ? { categoryWarning: assessment } : {}), ...(duplicateNotice ? { duplicate: duplicateNotice } : {}) } }
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
    if (user && query.mine !== 'true' && query.excludeMine === 'true') conditions.push(`r.buyer_id <> $${params.push(user.id)}`)
    if (typeof query.buyerUsername === 'string' && query.buyerUsername.trim()) { params.push(query.buyerUsername.trim().toLowerCase()); conditions.push(`u.username_normalized = $${params.length}`) }
    if (typeof query.categoryId === 'string' && uuid(query.categoryId)) conditions.push(categoryFilterSql('r.category_id', params.push(query.categoryId)))
    if (typeof query.countryCode === 'string' && query.countryCode.trim()) conditions.push(`r.country_code = $${params.push(query.countryCode.trim().toUpperCase())}`)
    if (typeof query.settlementCode === 'string' && query.settlementCode.trim()) {
        const settlement = getSettlement(query.settlementCode)
        if (!settlement) return invalid(['settlementCode'])
        conditions.push(settlementCondition('r.settlement_code', 'r.geo_area', { settlementCode: settlement.code, cityName: settlement.name }, params))
    }
    if (typeof query.region === 'string' && query.region.trim()) {
        const region = query.region.trim()
        if (!settlementCodesInRegion(region).length) return invalid(['region'])
        conditions.push(regionCondition('r.settlement_code', 'r.geo_area', region, params))
    }
    const search = query.searchIn === 'owner'
        ? null
        : smartSearchSql(listingSearchColumns('buyRequest'), typeof query.q === 'string' ? query.q : undefined, params, query.searchIn === 'title')
    if (query.searchIn === 'owner') conditions.push(...textSearchConditions(['u.username', 'u.nickname'], typeof query.q === 'string' ? query.q : undefined, params))
    if (search) conditions.push(search.condition)
    const mine = Boolean(user && query.mine === 'true')
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(query.limit ?? '50'), 10) || 50))
    const where = conditions.join(' AND ')
    const countParams = [...params]
    const order = search ? `${search.rank} DESC, r.created_at DESC, r.id DESC` : mine ? 'r.updated_at DESC, r.id DESC' : 'r.created_at DESC, r.id DESC'
    const result = await pool.query(`${requestSelect} WHERE ${where} ORDER BY ${order} LIMIT $${params.length + 1} OFFSET $${params.length + 2}`, [...params, limit, (page - 1) * limit])
    const total = result.rows.length ? Number(result.rows[0].total_count) : page === 1 ? 0 : Number((await pool.query<{ count: string }>(`SELECT count(*) FROM buy_requests r JOIN users u ON u.id = r.buyer_id JOIN categories c ON c.id = r.category_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id WHERE ${where}`, countParams)).rows[0].count)
    return { status: 200, body: { buyRequests: result.rows.map((row) => requestDto(row, user?.id === row.buyer_id)), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } }
}

export const updateBuyRequest = async (user: AuthUser, id: string, input: Record<string, unknown>) => {
    if ('geoArea' in input && !('settlementCode' in input)) input = { ...input, settlementCode: null }
    if (getSettlement(input.settlementCode) && !('geoArea' in input)) input = { ...input, geoArea: getSettlement(input.settlementCode)!.name }
    const errors = validateBuyRequestInput(input, true)
    if (errors.length) return invalid(errors)
    const normalizedInput = { ...input }
    if (input.receiptMethod !== undefined) {
        normalizedInput.deliveryRequired = input.receiptMethod === 'SELLER_DELIVERY'
        normalizedInput.preferredDelivery = input.receiptMethod === 'SELF_PICKUP' ? 'pickup' : input.receiptMethod === 'SELLER_DELIVERY' ? 'seller_delivery' : null
    } else if (input.delivery !== undefined || input.deliveryRequired !== undefined || input.preferredDelivery !== undefined) {
        // A legacy edit cannot keep a stale explicit receipt method.
        normalizedInput.receiptMethod = null
    }
    if (input.exactPrice !== undefined) { normalizedInput.minPrice = input.exactPrice; normalizedInput.maxPrice = input.exactPrice }
    if (input.delivery !== undefined && input.receiptMethod === undefined) { normalizedInput.deliveryRequired = input.delivery !== 'no'; if (input.delivery === 'preferred') normalizedInput.preferredDelivery = input.preferredDelivery ?? 'preferred' }
    const allowed: Record<string, string> = { categoryId: 'category_id', productId: 'product_id', title: 'title', description: 'description', quantity: 'requested_quantity', unit: 'unit', currency: 'currency', minPrice: 'min_unit_price', maxPrice: 'max_unit_price', deliveryRequired: 'delivery_required', preferredDelivery: 'preferred_delivery', geoArea: 'geo_area', countryCode: 'country_code', receiptMethod: 'receipt_method', deliveryOptions: 'delivery_options', settlementCode: 'settlement_code', address: 'delivery_address', addressVisibility: 'address_visibility', mapLocationMode: 'map_location_mode', latitude: 'latitude', longitude: 'longitude', deadline: 'deadline', fulfillmentMode: 'fulfillment_mode', status: 'status' }
    if (normalizedInput.deliveryOptions !== undefined) normalizedInput.deliveryOptions = JSON.stringify(normalizedInput.deliveryOptions)
    const { assignments, values } = buildUpdate(allowed, normalizedInput)
    if (!assignments.length && input.photos === undefined) return invalid(['buyRequest'])
    const client = await pool.connect()
    let committed = false
    let categoryWarning: Awaited<ReturnType<typeof assessCategory>> | null = null
    const storedPhotos: StoredPhoto[] = []
    let removedPhotos: string[] = []
    try {
    await client.query('BEGIN')
    const current = await client.query('SELECT category_id, title, description, unit, status, fulfilled_quantity, country_code, settlement_code, geo_area, latitude, longitude, delivery_address, map_location_mode, receipt_method, requested_quantity, selected_quantity, completed_quantity, fulfillment_mode, delivery_options FROM buy_requests WHERE id = $1 AND buyer_id = $2 FOR UPDATE', [id, user.id])
    if (!current.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    const country = 'countryCode' in input ? input.countryCode : current.rows[0].country_code
    const settlement = 'settlementCode' in input ? input.settlementCode : current.rows[0].settlement_code
    if (settlement != null && country != null && country !== 'UA') return invalid(['countryCode'])
    if (input.categoryId !== undefined && !(await categoryExists(client, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE' } }
    if (['categoryId', 'title', 'description', 'unit'].some(key => key in input)) {
        const previous = current.rows[0]
        const assessment = await assessCategory({ title: String(input.title ?? previous.title), description: String(input.description ?? previous.description), categoryId: String(input.categoryId ?? previous.category_id), unit: String(input.unit ?? previous.unit) }, client)
        if (assessment.level === 'warn') categoryWarning = assessment
    }
    let duplicateNotice: Awaited<ReturnType<typeof categoryDuplicates>>['notice'] = null
    if (['categoryId', 'title', 'description'].some(key => key in input)) {
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id])
        const previous = current.rows[0]
        const duplicates = await categoryDuplicates(client, 'buy_request', user.id,
            String(input.title ?? previous.title), String(input.description ?? previous.description), String(input.categoryId ?? previous.category_id), id)
        duplicateNotice = duplicates.notice
        if (duplicates.massAbuse) return { status: 409, body: { error: 'CATEGORY_DUPLICATE_ABUSE', message: 'Однаковий запит уже розміщено в кількох категоріях.', duplicate: duplicates.notice } }
    }
    const immutableAfterOffers = ['categoryId', 'productId', 'quantity', 'unit', 'currency']
    const hasOffers = Boolean((await client.query('SELECT 1 FROM offers WHERE buy_request_id = $1 LIMIT 1', [id])).rowCount)
    const hasDeals = Boolean((await client.query('SELECT 1 FROM orders WHERE buy_request_id = $1 LIMIT 1', [id])).rowCount)
    if (input.fulfillmentMode === 'single_seller' && input.fulfillmentMode !== current.rows[0].fulfillment_mode) {
        const sellers = await client.query("SELECT DISTINCT seller_id FROM orders WHERE buy_request_id = $1 AND status NOT IN ('cancelled', 'failed', 'rejected', 'expired') LIMIT 2", [id])
        if (sellers.rowCount && sellers.rowCount > 1) return { status: 409, body: { error: 'FULFILLMENT_MODE_LOCKED', message: 'Режим одного продавця недоступний: запит уже має угоди з різними продавцями.' } }
    }
    if (input.deliveryOptions !== undefined && !isDeepStrictEqual(input.deliveryOptions, current.rows[0].delivery_options) && (hasOffers || hasDeals)) return { status: 409, body: { error: 'DELIVERY_OPTIONS_LOCKED', message: 'Способи отримання не можна змінити після появи пропозиції або угоди.' } }
    const geographyFields: Record<string, string> = { countryCode: 'country_code', settlementCode: 'settlement_code', geoArea: 'geo_area', latitude: 'latitude', longitude: 'longitude', address: 'delivery_address', mapLocationMode: 'map_location_mode', receiptMethod: 'receipt_method' }
    const geographyChanged = Object.entries(geographyFields).some(([key, column]) => key in input && (key === 'latitude' || key === 'longitude'
        ? (input[key] == null ? null : Number(input[key])) !== (current.rows[0][column] == null ? null : Number(current.rows[0][column]))
        : input[key] !== current.rows[0][column]))
    if ((hasOffers || hasDeals) && geographyChanged) return { status: 409, body: { error: 'DELIVERY_OPTIONS_LOCKED', message: 'Місце й спосіб отримання не можна змінити після появи пропозиції або угоди.' } }
    if (geographyChanged && !await verifiedInputPoint({ settlementCode: settlement, label: 'geoArea' in input ? input.geoArea : current.rows[0].geo_area,
        countryCode: country, latitude: 'latitude' in input ? input.latitude : number(current.rows[0].latitude),
        longitude: 'longitude' in input ? input.longitude : number(current.rows[0].longitude) })) { await client.query('ROLLBACK'); return invalid(['latitude', 'longitude']) }
    if ((hasOffers || hasDeals) && Object.keys(normalizedInput).some((key) => key in allowed && immutableAfterOffers.includes(key))) return { status: 409, body: { error: 'REQUEST_TERMS_LOCKED' } }
    if (input.quantity !== undefined && Number(input.quantity) < Number(current.rows[0].selected_quantity) + Number(current.rows[0].completed_quantity)) return { status: 409, body: { error: 'REQUEST_QUANTITY_BELOW_ALLOCATED' } }
    if (input.status !== undefined && !['cancelled', 'expired'].includes(String(input.status))) return { status: 409, body: { error: 'REQUEST_STATUS_MANAGED_BY_DEALS' } }
    const { idParam, ownerParam } = withOwnerConditions(values, id, user.id)
    const result = await client.query(`UPDATE buy_requests SET ${assignments.length ? assignments.join(', ') + ', ' : ''}closed_at = CASE WHEN status = 'cancelled' THEN now() ELSE closed_at END, updated_at = now() WHERE id = ${idParam} AND buyer_id = ${ownerParam} AND status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled') RETURNING id`, values)
    if (!result.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    if (duplicateNotice) await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_duplicate', 'buy_request', id, JSON.stringify(duplicateNotice)])
    if (categoryWarning) await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_warning', 'buy_request', id, JSON.stringify({ suggestions: categoryWarning.suggestions })])
    if (Array.isArray(input.photos)) {
        const photoResult = await saveRequestPhotos(client, id, input.photos as PhotoUpload[], storedPhotos)
        if (!Array.isArray(photoResult)) return photoResult
        removedPhotos = photoResult
    }
    if (input.status === 'cancelled' || input.status === 'expired') {
        await client.query('UPDATE buy_requests SET closed_at = now() WHERE id = $1', [id])
        await client.query("UPDATE negotiation_proposals SET status = 'expired', responded_at = now() WHERE offer_id IN (SELECT id FROM offers WHERE buy_request_id = $1) AND status = 'pending'", [id])
    }
    await client.query('COMMIT'); committed = true
    for (const storageKey of removedPhotos) await requestPhotoStorage.remove(storageKey)
    const response = await getBuyRequest(id, user)
    return { ...response, body: { ...response.body, ...(categoryWarning ? { categoryWarning } : {}), ...(duplicateNotice ? { duplicate: duplicateNotice } : {}) } }
    } finally { if (!committed) { await client.query('ROLLBACK'); for (const photo of storedPhotos) await requestPhotoStorage.remove(photo.storageKey) } client.release() }
}

export const listOffers = async (user: AuthUser, requestId: string) => {
    const request = await pool.query('SELECT buyer_id FROM buy_requests WHERE id = $1', [requestId])
    if (!request.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    const isBuyer = request.rows[0].buyer_id === user.id
    const isSeller = Boolean((await pool.query('SELECT 1 FROM offers WHERE buy_request_id = $1 AND seller_id = $2', [requestId, user.id])).rowCount)
    if (!isBuyer && !isSeller) return { status: 403, body: { error: 'FORBIDDEN' } }
    const result = await pool.query(`${offerSelect} WHERE o.buy_request_id = $1 ${isBuyer ? '' : 'AND o.seller_id = $2'} ORDER BY o.created_at`, isBuyer ? [requestId] : [requestId, user.id])
    return { status: 200, body: { offers: await Promise.all(result.rows.map(offerDto)) } }
}

export const listMyOffers = async (user: AuthUser, page = 1) => {
    const safePage = Math.max(1, Number.parseInt(String(page), 10) || 1)
    const count = await pool.query<{ count: string }>('SELECT count(*) FROM offers WHERE seller_id = $1', [user.id])
    const result = await pool.query(`${offerSelect} WHERE o.seller_id = $1 ORDER BY o.updated_at DESC, o.id DESC LIMIT 100 OFFSET $2`, [user.id, (safePage - 1) * 100])
    return { status: 200, body: { offers: await Promise.all(result.rows.map(offerDto)), pagination: { page: safePage, pages: Math.ceil(Number(count.rows[0].count) / 100) } } }
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
    if (input.creationMode === 'manual' && !input.title) return invalid(['title'])
    if (input.creationMode === 'product' && !input.productId) return invalid(['productId'])
    if (Array.isArray(input.deliveryOptions) && input.deliveryOptions.length !== 1) return invalid(['deliveryOptions'])
    const client = await pool.connect()
    let committed = false
    const storedPhotos: StoredPhoto[] = []
    try {
    await client.query('BEGIN')
    const request = await client.query('SELECT buyer_id, category_id, title, requested_quantity, unit, currency, status, deadline FROM buy_requests WHERE id = $1 FOR UPDATE', [requestId])
    if (!request.rowCount) return { status: 404, body: { error: 'BUY_REQUEST_NOT_FOUND' } }
    if (request.rows[0].deadline && request.rows[0].deadline <= new Date()) return { status: 409, body: { error: 'BUY_REQUEST_CLOSED' } }
    if (request.rows[0].buyer_id === user.id) return { status: 403, body: { error: 'BUYER_CANNOT_OFFER' } }
    if (await usersAreBlocked(client, request.rows[0].buyer_id, user.id)) return { status: 403, body: { error: 'USER_BLOCKED' } }
    if (!['open', 'partially_selected', 'partially_completed', 'partially_fulfilled'].includes(request.rows[0].status)) return { status: 409, body: { error: 'BUY_REQUEST_CLOSED' } }
    if (input.unit !== request.rows[0].unit || input.currency !== request.rows[0].currency) return invalid(['unit', 'currency'])
    await client.query('SELECT pg_advisory_xact_lock($1, $2)', offerPhotoLock)
    const product = input.productId ? await client.query('SELECT title, description, quantity, reserved_quantity, delivery_options FROM products WHERE id = $1 AND owner_id = $2 AND status = $3 AND category_id = $4 AND quantity > reserved_quantity FOR SHARE', [input.productId, user.id, 'active', request.rows[0].category_id]) : null
    if (input.productId && !product?.rowCount) return { status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE' } }
    if (Array.isArray(input.deliveryOptions)) {
        const option = input.deliveryOptions[0] as DeliveryOption
        if (!await verifiedDeliveryOptions([option])) return invalid(['deliveryOptions'])
        if (input.productId && !(product?.rows[0].delivery_options as DeliveryOption[] | null)?.some(candidate => isDeepStrictEqual(candidate, option))) return { status: 409, body: { error: 'PRODUCT_DELIVERY_MISMATCH', message: 'Цей спосіб не підтверджений вибраним товаром.' } }
        if (!input.productId && ['SELF_PICKUP', 'SELLER_DELIVERY'].includes(option.method) && !option.place?.settlementCode) return invalid(['deliveryOptions'])
        if (!input.productId && option.method === 'SELLER_DELIVERY' && (option.radiusKm ?? 0) > 0 && !option.place?.publicPoint) return invalid(['deliveryOptions'])
    }
    const title = typeof input.title === 'string' ? input.title.trim() : product?.rows[0]?.title ?? request.rows[0].title
    const description = typeof input.description === 'string' ? input.description : product?.rows[0]?.description ?? ''
    const terms = { note: input.note ?? '', additionalPhotoUrl: input.additionalPhotoUrl ?? null, availableAt: input.availableAt ?? '' }
    const created = await client.query<{ id: string }>(
        'INSERT INTO offers (buy_request_id, seller_id, product_id, offered_quantity, unit, unit_price, currency, delivery, note, additional_photo_url, terms, delivery_terms, valid_until, title, description, characteristics, creation_mode, delivery_options) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id',
        [requestId, user.id, input.productId ?? null, input.quantity, input.unit, input.price, input.currency, input.delivery, input.note ?? '', input.additionalPhotoUrl ?? null, JSON.stringify(terms), JSON.stringify({ delivery: input.delivery, price: input.deliveryPrice ?? 0 }), input.validUntil ?? null, title, description, input.characteristics ?? '', input.creationMode ?? null, input.deliveryOptions === undefined ? null : JSON.stringify(input.deliveryOptions)],
    )
    const sourcePhotos = input.photos === undefined && input.productId
        ? (await client.query<PhotoUpload>('SELECT url, alt FROM product_photos WHERE product_id=$1 ORDER BY sort_order, id LIMIT 8', [input.productId])).rows
        : input.photos as PhotoUpload[] | undefined ?? []
    const savedPhotos = await saveOfferPhotos(client, created.rows[0].id, input.productId as string | null ?? null, sourcePhotos, storedPhotos)
    if (!Array.isArray(savedPhotos)) return savedPhotos
    const result = await client.query(`${offerSelect} WHERE o.id = $1`, [created.rows[0].id])
    await createNotification(client, request.rows[0].buyer_id, 'order', 'Нова пропозиція', 'Продавець відповів на ваш запит', 'buying', { buyRequestId: requestId })
    await audit(client, user.id, 'offer.created', 'offer', created.rows[0].id, { requestId })
    await client.query('COMMIT'); committed = true
    return { status: 201, body: { offer: await offerDto(result.rows[0]) } }
    } finally { if (!committed) { await client.query('ROLLBACK'); for (const photo of storedPhotos) await offerPhotoStorage.remove(photo.storageKey) } client.release() }
}

export const acceptOffer = async (user: AuthUser, offerId: string, input: Record<string, unknown>) => {
    const requestedQuantity = input.quantity
    if (input.selectionKey !== undefined && !uuid(input.selectionKey)) return invalid(['selectionKey'])
    const client = await pool.connect()
    const storedPhotos: StoredPhoto[] = []
    let committed = false
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
        if (typeof requestedQuantity !== 'number' || !Number.isFinite(requestedQuantity) || requestedQuantity <= 0) { await client.query('ROLLBACK'); return invalid(['quantity']) }
        const selectionQuantity = requestedQuantity
        if (selectionQuantity <= 0 || Math.abs(selectionQuantity * 1000 - Math.round(selectionQuantity * 1000)) > 0.00001) { await client.query('ROLLBACK'); return invalid(['quantity']) }
        const acceptance = validateAcceptance(row, request.rows[0], selectionQuantity)
        if (!acceptance.ok) { await client.query('ROLLBACK'); return { ...acceptance, body: { ...acceptance.body, remainingQuantity: Number(request.rows[0].requested_quantity) - Number(request.rows[0].selected_quantity) - Number(request.rows[0].completed_quantity), message: 'Залишок або доступність пропозиції змінилися. Оновіть умови перед вибором.' } } }
        const negotiated = (await client.query("SELECT * FROM negotiation_proposals WHERE offer_id = $1 AND status = 'accepted' ORDER BY created_at DESC, id DESC LIMIT 1", [offerId])).rows[0]
        const agreed = negotiated?.status === 'accepted' ? negotiated : null
        if ((input.negotiationProposalId !== undefined && input.negotiationProposalId !== (agreed?.id ?? null)) || (agreed && Number(agreed.quantity) !== selectionQuantity) || (input.expectedPrice !== undefined && Number(agreed?.unit_price ?? row.unit_price) !== input.expectedPrice)) {
            await client.query('ROLLBACK'); return { status: 409, body: { error: 'TERMS_CHANGED', message: 'Умови змінилися. Перегляньте погоджену ціну й кількість перед вибором.' } }
        }
        const unitPrice = Number(agreed?.unit_price ?? row.unit_price)
        const delivery = agreed ? { delivery: agreed.delivery, price: Number(agreed.delivery_price), options: row.delivery_options } : { delivery: row.delivery, price: Number(row.delivery_terms?.price ?? 0), options: row.delivery_options }
        if ((input.expectedDelivery !== undefined && input.expectedDelivery !== delivery.delivery) || (input.expectedDeliveryPrice !== undefined && input.expectedDeliveryPrice !== delivery.price)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'TERMS_CHANGED', message: 'Умови доставки змінилися. Перегляньте новий підсумок.' } } }
        if (await usersAreBlocked(client, user.id, row.seller_id)) { await client.query('ROLLBACK'); return { status: 403, body: { error: 'USER_BLOCKED' } } }
        if (request.rows[0].fulfillment_mode === 'single_seller') {
            const chosenSeller = await client.query<{ seller_id: string }>("SELECT seller_id FROM orders WHERE buy_request_id = $1 AND status NOT IN ('cancelled', 'failed', 'rejected', 'expired') LIMIT 1", [linked.buy_request_id])
            if (chosenSeller.rows[0] && chosenSeller.rows[0].seller_id !== row.seller_id) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'REQUEST_ALREADY_ALLOCATED', message: 'Для цього запиту вже обрано іншого продавця.' } } }
        }
        const accepted = Number(row.accepted_quantity) + selectionQuantity
        const offerStatus = accepted === Number(row.offered_quantity) ? 'accepted' : 'partially_accepted'
        await client.query('SELECT pg_advisory_xact_lock($1, $2)', offerPhotoLock)
        if (row.product_id) {
            const stock = await client.query('UPDATE products SET reserved_quantity = reserved_quantity + $1, updated_at = now() WHERE id = $2 AND status = $3 AND quantity - reserved_quantity >= $1 RETURNING id', [selectionQuantity, row.product_id, 'active'])
            if (!stock.rowCount) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'PRODUCT_STOCK_UNAVAILABLE' } } }
        }
        await client.query('UPDATE offers SET accepted_quantity = $1, status = $2, updated_at = now() WHERE id = $3', [accepted, offerStatus, offerId])
        const product = row.product_id ? await client.query<{ title: string }>('SELECT title FROM products WHERE id = $1', [row.product_id]) : { rows: [] as { title: string }[] }
        const goodsTotal = Math.round(selectionQuantity * unitPrice * 100) / 100
        const subtotal = goodsTotal + delivery.price
        const title = row.title ?? product.rows[0]?.title ?? request.rows[0].title
        let photoSnapshot = (await client.query('SELECT url, alt FROM offer_photos WHERE offer_id=$1 ORDER BY sort_order, id', [offerId])).rows
        if (row.creation_mode === null && photoSnapshot.length === 0 && row.product_id) {
            const legacyPhotos = (await client.query<PhotoUpload>('SELECT url, alt FROM product_photos WHERE product_id=$1 ORDER BY sort_order, id LIMIT 8', [row.product_id])).rows
            if (legacyPhotos.length) {
                const copied = await saveOfferPhotos(client, offerId, row.product_id, legacyPhotos, storedPhotos)
                if (!Array.isArray(copied)) { await client.query('ROLLBACK'); return copied }
                photoSnapshot = (await client.query('SELECT url, alt FROM offer_photos WHERE offer_id=$1 ORDER BY sort_order, id', [offerId])).rows
            }
        }
        const order = await client.query<{ id: string }>('INSERT INTO orders (buy_request_id, offer_id, buyer_id, seller_id, status, currency, subtotal, quantity, unit, unit_price, conditions_snapshot, selection_key, negotiation_proposal_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id', [row.buy_request_id, row.id, user.id, row.seller_id, 'selected', row.currency, subtotal, selectionQuantity, row.unit, unitPrice, JSON.stringify({ offerId: row.id, productTitle: title, description: row.description, characteristics: row.characteristics, photos: photoSnapshot, originalOffer: { price: Number(row.unit_price), quantity: Number(row.offered_quantity), delivery: row.delivery, note: row.note }, terms: row.terms, delivery, goodsTotal, grandTotal: subtotal, negotiated: agreed ? { id: agreed.id, price: unitPrice, quantity: selectionQuantity, delivery } : null }), input.selectionKey ?? null, agreed?.id ?? null])
        await client.query('INSERT INTO order_items (order_id, offer_id, product_id, quantity, unit, unit_price, currency, product_title_snapshot, offer_terms_snapshot, delivery_terms_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)', [order.rows[0].id, row.id, row.product_id, selectionQuantity, row.unit, unitPrice, row.currency, title, JSON.stringify({ ...row.terms, description: row.description, characteristics: row.characteristics, photos: photoSnapshot }), JSON.stringify(delivery)])
        await createOrderConversation(client, order.rows[0].id, user.id, row.seller_id, row.id)
        await refreshRequestQuantities(client, row.buy_request_id)
        await audit(client, user.id, 'offer.selected', 'offer', offerId, { quantity: selectionQuantity, orderId: order.rows[0].id })
        await audit(client, user.id, 'OFFER_SELECTED', 'order', order.rows[0].id, { offerId, requestId: row.buy_request_id })
        await audit(client, user.id, 'SELLER_CONFIRMATION_REQUESTED', 'order', order.rows[0].id)
        await client.query('COMMIT'); committed = true
        return { status: 201, body: { order: { id: order.rows[0].id, buyRequestId: row.buy_request_id, sellerId: row.seller_id, quantity: selectionQuantity, subtotal, status: 'selected' } } }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { if (!committed) for (const photo of storedPhotos) await offerPhotoStorage.remove(photo.storageKey); client.release() }
}

export const updateOffer = async (user: AuthUser, offerId: string, input: Record<string, unknown>) => {
    const errors = validateOfferInput(input, true)
    if (errors.length) return invalid(errors)
    if (Array.isArray(input.deliveryOptions) && input.deliveryOptions.length !== 1) return invalid(['deliveryOptions'])
    const allowed: Record<string, string> = { productId: 'product_id', quantity: 'offered_quantity', unit: 'unit', price: 'unit_price', currency: 'currency', delivery: 'delivery', deliveryOptions: 'delivery_options', note: 'note', additionalPhotoUrl: 'additional_photo_url', validUntil: 'valid_until', title: 'title', description: 'description', characteristics: 'characteristics' }
    const normalizedInput = { ...input, ...(input.deliveryOptions === undefined ? {} : { deliveryOptions: JSON.stringify(input.deliveryOptions) }) }
    const { assignments, values } = buildUpdate(allowed, normalizedInput)
    if (input.deliveryPrice !== undefined) assignments.push(`delivery_terms = delivery_terms || jsonb_build_object('price', $${values.push(input.deliveryPrice)}::numeric)`)
    if (input.availableAt !== undefined) assignments.push(`terms = terms || jsonb_build_object('availableAt', $${values.push(input.availableAt)}::text)`)
    if (!assignments.length && input.photos === undefined) return invalid(['offer'])
    const client = await pool.connect()
    let committed = false
    const storedPhotos: StoredPhoto[] = []
    let removedPhotos: string[] = []
    try {
        await client.query('BEGIN')
        const link = (await client.query('SELECT buy_request_id FROM offers WHERE id = $1 AND seller_id = $2', [offerId, user.id])).rows[0]
        if (!link) return { status: 404, body: { error: 'OFFER_NOT_FOUND' } }
        const request = (await client.query('SELECT * FROM buy_requests WHERE id = $1 FOR UPDATE', [link.buy_request_id])).rows[0]
        const existing = (await client.query('SELECT * FROM offers WHERE id = $1 FOR UPDATE', [offerId])).rows[0]
        if (existing.status !== 'submitted' || Number(existing.accepted_quantity) > 0) return { status: 409, body: { error: 'OFFER_TERMS_LOCKED' } }
        if (!['open', 'partially_selected', 'partially_completed', 'partially_fulfilled'].includes(request.status)) return { status: 409, body: { error: 'BUY_REQUEST_CLOSED' } }
        if ((input.unit !== undefined && input.unit !== request.unit) || (input.currency !== undefined && input.currency !== request.currency)) return invalid(['unit','currency'])
        if (input.photos !== undefined) await client.query('SELECT pg_advisory_xact_lock($1, $2)', offerPhotoLock)
        if (input.productId !== undefined && input.productId !== existing.product_id) {
            if (input.productId === null) {
                // Removing an existing link is allowed by the current editable-offer rules.
            } else {
            const product = await client.query("SELECT id FROM products WHERE id=$1 AND owner_id=$2 AND category_id=$3 AND status='active' AND quantity > reserved_quantity", [input.productId, user.id, request.category_id])
            if (!product.rowCount) return { status: 400, body: { error: 'PRODUCT_NOT_AVAILABLE' } }
            }
        }
        const selectedProductId = input.productId === undefined ? existing.product_id : input.productId
        const selectedOptions = input.deliveryOptions === undefined ? existing.delivery_options as DeliveryOption[] | null : input.deliveryOptions as DeliveryOption[]
        if (selectedOptions?.length) {
            const option = selectedOptions[0]
            if (input.deliveryOptions !== undefined && !await verifiedDeliveryOptions([option])) return invalid(['deliveryOptions'])
            if (selectedProductId) {
                const linkedProduct = await client.query<{ delivery_options: DeliveryOption[] | null }>('SELECT delivery_options FROM products WHERE id=$1 AND owner_id=$2 FOR SHARE', [selectedProductId, user.id])
                if (!linkedProduct.rows[0]?.delivery_options?.some(candidate => isDeepStrictEqual(candidate, option))) return { status: 409, body: { error: 'PRODUCT_DELIVERY_MISMATCH' } }
            } else if (['SELF_PICKUP', 'SELLER_DELIVERY'].includes(option.method) && (!option.place?.settlementCode || option.method === 'SELLER_DELIVERY' && (option.radiusKm ?? 0) > 0 && !option.place.publicPoint)) return invalid(['deliveryOptions'])
        }
        const { idParam, ownerParam } = withOwnerConditions(values, offerId, user.id)
        await client.query(`UPDATE offers SET ${assignments.length ? assignments.join(', ') + ', ' : ''}updated_at = now() WHERE id = ${idParam} AND seller_id = ${ownerParam}`, values)
        if (input.photos !== undefined) {
            const result = await saveOfferPhotos(client, offerId, (input.productId === undefined ? existing.product_id : input.productId) as string | null, input.photos as PhotoUpload[], storedPhotos)
            if (!Array.isArray(result)) return result
            removedPhotos = result
            await client.query("UPDATE offers SET creation_mode = CASE WHEN product_id IS NULL THEN 'manual' ELSE 'product' END WHERE id=$1 AND creation_mode IS NULL", [offerId])
        }
        await client.query(`UPDATE offers SET terms = terms || jsonb_build_object('note', note, 'additionalPhotoUrl', additional_photo_url), delivery_terms = delivery_terms || jsonb_build_object('delivery', delivery) WHERE id=$1`, [offerId])
        const conversation = (await client.query('SELECT id FROM conversations WHERE offer_id=$1',[offerId])).rows[0]
        const updateText = input.price !== undefined ? `Продавець змінив ціну пропозиції: ${existing.unit_price} → ${input.price} ${currencyLabel(existing.currency)}. Погоджені раніше умови залишаються в історії.` : 'Продавець оновив пропозицію. Перегляньте актуальні умови.'
        if (conversation) {
            await client.query("INSERT INTO messages (conversation_id,sender_id,body,kind) VALUES ($1,$2,$3,'system')", [conversation.id,user.id,updateText])
        }
        await createNotification(client, request.buyer_id, 'order', 'Пропозицію оновлено', updateText, 'buying', { conversationId: conversation?.id, buyRequestId: link.buy_request_id })
        const result = await client.query(`${offerSelect} WHERE o.id = $1`, [offerId])
        await audit(client, user.id, 'offer.updated', 'offer', offerId)
        await client.query('COMMIT'); committed = true
        if (removedPhotos.length) {
            await client.query('SELECT pg_advisory_lock($1, $2)', offerPhotoLock)
            try {
                for (const photo of removedPhotos) {
                    const url = `/uploads/offers/${photo}`
                    const stillUsed = await client.query<{ in_use: boolean }>(`SELECT
                        EXISTS (SELECT 1 FROM offer_photos WHERE storage_key=$1 OR url=$2)
                        OR EXISTS (SELECT 1 FROM offers WHERE additional_photo_url=$2 OR terms->>'additionalPhotoUrl'=$2)
                        OR EXISTS (SELECT 1 FROM orders WHERE conditions_snapshot @> jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('url', $2::text)))
                            OR conditions_snapshot->'terms'->>'additionalPhotoUrl'=$2)
                        OR EXISTS (SELECT 1 FROM order_items WHERE offer_terms_snapshot @> jsonb_build_object('photos', jsonb_build_array(jsonb_build_object('url', $2::text)))
                            OR offer_terms_snapshot->>'additionalPhotoUrl'=$2) AS in_use`, [photo, url])
                    if (!stillUsed.rows[0].in_use) await offerPhotoStorage.remove(photo)
                }
            } finally {
                await client.query('SELECT pg_advisory_unlock($1, $2)', offerPhotoLock)
            }
        }
        return { status: 200, body: { offer: await offerDto(result.rows[0]) } }
    } finally { if (!committed) { await client.query('ROLLBACK'); for (const photo of storedPhotos) await offerPhotoStorage.remove(photo.storageKey) } client.release() }
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
        await createNotification(client, request.buyer_id, 'order', 'Пропозицію відкликано', 'Створені домовленості залишаються чинними.', 'buying', { conversationId: conversation?.id ?? null, buyRequestId: link.buy_request_id })
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
    await createNotification(pool, result.rows[0].seller_id, 'order', 'Пропозицію відхилено', 'Покупець відхилив вашу пропозицію', 'selling', { buyRequestId: offer.rows[0].buy_request_id })
    await audit(pool, user.id, 'offer.rejected', 'offer', offerId)
    return { status: 204, body: null }
}
