import { randomUUID } from 'node:crypto'
import { exchangeRates } from './exchange-rates.js'
import { getSettlement, settlementCodesInRegion } from './settlements.js'
import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { categoryFilterSql, retiredCategoryCodesSql } from './category-filter.js'
import { textSearchConditions } from './text-search.js'
import { listingSearchColumns, smartSearchSql } from './smart-search.js'
import { approximatePoint, regionCondition, settlementCondition } from './map-service.js'
import { ExternalUrlPhotoStorage, type PhotoStorage, type StoredPhoto } from './photo-storage.js'
import { validateProductInput, type ProductInput, type ProductStatus } from './product-validation.js'
import { verifiedDeliveryOptions, verifiedInputPoint } from './delivery-geography.js'
import { postalTermsDefined, type DeliveryOption } from './delivery-compatibility.js'
import { assessCategory } from './category-recommendation.js'
import { categoryDuplicates } from './category-duplicates.js'
import { isDeepStrictEqual } from 'node:util'
import { validateAttributes } from './category-attributes.js'

type ProductRow = {
    attributes: Record<string, unknown>
    total_count?: string
    settlement_code?: string | null
    public_address?: string | null
    id: string; owner_id: string; owner_username: string; category_id: string; category_code: string; category_name: string; category_image_index: number | null
    title: string; description: string; quantity: string | number; unit: string; price: string | number; currency: string
    delivery_mode: string; delivery_options: import('./delivery-compatibility.js').DeliveryOption[] | null; geo_zone: string; pickup_address: string | null; address_visibility: 'private' | 'public'; map_location_mode: 'profile' | 'pin' | 'address' | 'approximate'; latitude: string | number | null; longitude: string | number | null
    status: ProductStatus; reserved_quantity: string | number; expires_at: Date | null; created_at: Date; updated_at: Date
}
type PhotoRow = { id: string; storage_key: string; url: string; alt: string; sort_order: number }
type ProductWithPhotos = ProductRow & { photos: PhotoRow[] }
type Queryable = Pick<PoolClient, 'query'>

export const photoStorage: PhotoStorage = new ExternalUrlPhotoStorage()

const numberOrNull = (value: string | number | null) => value === null ? null : Number(value)
const toPhotoDto = (photo: PhotoRow) => ({ id: photo.id, url: photo.url, alt: photo.alt, order: photo.sort_order })
export const toProductDto = (row: ProductWithPhotos, includeAddress = false) => ({
    id: row.id,
    owner: { id: row.owner_id, username: row.owner_username },
    category: { id: row.category_id, code: row.category_code, name: row.category_name, imageIndex: row.category_image_index },
    title: row.title,
    description: row.description,
    attributes: row.attributes ?? {},
    photos: row.photos.map(toPhotoDto),
    quantity: Number(row.quantity),
    availableQuantity: Number(row.quantity) - Number(row.reserved_quantity),
    unit: row.unit,
    price: { amount: Number(row.price), currency: row.currency },
    deliveryMode: row.delivery_mode,
    deliveryOptions: row.delivery_options,
    geoZone: row.geo_zone,
    settlement: getSettlement(row.settlement_code),
    ...(row.public_address ? { publicAddress: row.public_address } : {}),
    addressVisibility: row.address_visibility,
    mapLocationMode: row.map_location_mode,
    address: includeAddress || row.address_visibility === 'public' ? row.pickup_address : null,
    coordinates: row.latitude === null || row.longitude === null ? null : includeAddress || row.address_visibility === 'public' || row.map_location_mode === 'pin' ? { latitude: Number(row.latitude), longitude: Number(row.longitude) } : approximatePoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }),
    status: row.status,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
})

const productSelect = `
    SELECT count(*) OVER() AS total_count, p.id, p.owner_id, u.username AS owner_username, p.category_id, c.code AS category_code, c.name AS category_name, c.image_index AS category_image_index,
           CASE WHEN p.address_visibility = 'public' THEN p.pickup_address WHEN p.map_location_mode = 'profile' AND u.map_location_mode = 'address' THEN u.exact_address ELSE NULL END AS public_address,
           p.title, p.description, p.attributes, p.quantity, p.reserved_quantity, p.unit, p.price, p.currency, p.delivery_mode, p.delivery_options, p.geo_zone,
           p.settlement_code, p.latitude, p.longitude, p.pickup_address, p.address_visibility, p.map_location_mode, p.status, p.expires_at, p.created_at, p.updated_at
    FROM products p JOIN users u ON u.id = p.owner_id JOIN categories c ON c.id = p.category_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id`

const getProductRow = async (queryable: Queryable, id: string, ownerId?: string): Promise<ProductWithPhotos | null> => {
    const conditions = ownerId ? 'p.id = $1 AND (p.status = \'active\' OR p.owner_id = $2)' : 'p.id = $1 AND p.status = \'active\''
    const parameters = ownerId ? [id, ownerId] : [id]
    const result = await queryable.query<ProductRow>(`${productSelect} WHERE ${conditions}`, parameters)
    const row = result.rows[0]
    if (!row) return null
    const photos = await queryable.query<PhotoRow>('SELECT id, storage_key, url, alt, sort_order FROM product_photos WHERE product_id = $1 ORDER BY sort_order, id', [id])
    return { ...row, photos: photos.rows }
}

const categoryExists = async (queryable: Queryable, categoryId: string) => {
    const result = await queryable.query('SELECT 1 FROM categories WHERE id = $1 AND is_active', [categoryId])
    return Boolean(result.rowCount)
}

const writePhotos = async (queryable: Queryable, productId: string, photos: ProductInput['photos'] = [], storedPhotos: StoredPhoto[]): Promise<void> => {
    for (const [index, photo] of photos.entries()) {
        const stored = await photoStorage.store(productId, photo, index)
        storedPhotos.push(stored)
        await queryable.query(
            'INSERT INTO product_photos (product_id, storage_key, url, alt, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [productId, stored.storageKey, stored.url, photo.alt ?? '', index],
        )
    }
}

const invalid = (fields: string[]) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте дані товару', fields } })

export const listCategories = async () => {
    const result = await pool.query(`SELECT c.id, c.parent_id AS "parentId", c.code, c.name, c.path,
        c.image_index AS "imageIndex", c.sort_order AS "sortOrder",
        ARRAY(SELECT a.alias FROM category_aliases a WHERE a.category_id=c.id ORDER BY a.alias) AS synonyms,
        ARRAY(SELECT old.id FROM categories old WHERE old.parent_id = c.id AND NOT old.is_active
            AND old.code IN (${retiredCategoryCodesSql}) ORDER BY old.code) AS "legacyIds"
        FROM categories c WHERE c.is_active ORDER BY c.sort_order, c.name, c.id`)
    return { status: 200, body: { categories: result.rows } }
}

export const listPopularCategories = async () => {
    const result = await pool.query<{ categoryId: string; count: string }>(`
        WITH RECURSIVE roots AS (
            SELECT id, id AS root_id FROM categories WHERE parent_id IS NULL
            UNION ALL
            SELECT child.id, roots.root_id FROM categories child JOIN roots ON child.parent_id = roots.id
        ), listings AS (
            SELECT category_id FROM products WHERE status = 'active'
            UNION ALL
            SELECT category_id FROM buy_requests WHERE status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')
        )
        SELECT roots.root_id AS "categoryId", COUNT(*)::text AS count
        FROM listings JOIN roots ON roots.id = listings.category_id
        GROUP BY roots.root_id
        ORDER BY COUNT(*) DESC
    `)
    return { status: 200, body: { categoryCounts: result.rows.map(item => ({ categoryId: item.categoryId, count: Number(item.count) })) } }
}

export const createProduct = async (user: AuthUser, input: Record<string, unknown>) => {
    const errors = validateProductInput(input)
    if (errors.length) return invalid(errors)
    if (!postalTermsDefined(input.deliveryOptions as DeliveryOption[] | undefined)) return invalid(['deliveryOptions'])
    if (input.deliveryMode === 'carrier' && !(input.deliveryOptions as DeliveryOption[] | undefined)?.some(option => option.method === 'POSTAL_DELIVERY' && option.postalOperators?.length)) return invalid(['deliveryOptions'])
    if (!await verifiedDeliveryOptions(input.deliveryOptions as ProductInput['deliveryOptions'])) return invalid(['deliveryOptions'])
    if (!await verifiedInputPoint({ settlementCode: input.settlementCode, label: input.geoZone, latitude: input.latitude, longitude: input.longitude })) return invalid(['latitude', 'longitude'])
    if (!(await categoryExists(pool, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE', message: 'Категорія недоступна' } }
    if (!await validateAttributes(input.categoryId as string, input.attributes === undefined ? {} : input.attributes)) return invalid(['attributes'])
    const assessment = await assessCategory({ title: String(input.title), description: String(input.description ?? ''), categoryId: String(input.categoryId), unit: String(input.unit) })
    const product = input as unknown as ProductInput
    const client = await pool.connect()
    const storedPhotos: StoredPhoto[] = []
    try {
        await client.query('BEGIN')
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id])
        const duplicates = product.status === 'active' ? await categoryDuplicates(client, 'product', user.id, product.title, product.description ?? '', product.categoryId) : null
        if (duplicates?.massAbuse) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'CATEGORY_DUPLICATE_ABUSE', message: 'Однакове оголошення вже розміщено в кількох категоріях.', duplicate: duplicates.notice } } }
        const result = await client.query<ProductRow>(
            `INSERT INTO products (owner_id, category_id, title, description, quantity, unit, price, currency, delivery_mode, geo_zone, latitude, longitude, status, expires_at, pickup_address, settlement_code, address_visibility, map_location_mode, delivery_options, attributes)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20) RETURNING id`,
            [user.id, product.categoryId, product.title.trim(), product.description ?? '', product.quantity, product.unit, product.price, product.currency, product.deliveryMode, product.geoZone.trim(), product.latitude ?? null, product.longitude ?? null, product.status ?? 'draft', product.expiresAt ?? null, product.address?.trim() || null, product.settlementCode ?? null, product.addressVisibility ?? 'private', product.mapLocationMode ?? 'profile', product.deliveryOptions === undefined ? null : JSON.stringify(product.deliveryOptions), JSON.stringify(input.attributes ?? {})],
        )
        await writePhotos(client, result.rows[0].id, product.photos, storedPhotos)
        if (assessment.level === 'warn') await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_warning', 'product', result.rows[0].id, JSON.stringify({ suggestions: assessment.suggestions })])
        if (duplicates?.notice) await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_duplicate', 'product', result.rows[0].id, JSON.stringify(duplicates.notice)])
        const created = await getProductRow(client, result.rows[0].id, user.id)
        await client.query('COMMIT')
        return { status: 201, body: { product: toProductDto(created!, true), ...(assessment.level === 'warn' ? { categoryWarning: assessment } : {}), ...(duplicates?.notice ? { duplicate: duplicates.notice } : {}) } }
    } catch (error) {
        await client.query('ROLLBACK')
        for (const photo of storedPhotos) await photoStorage.remove(photo.storageKey)
        throw error
    } finally { client.release() }
}

export const getProduct = async (id: string, user?: AuthUser) => {
    const product = await getProductRow(pool, id, user?.id)
    return product ? { status: 200, body: { product: toProductDto(product, product.owner_id === user?.id) } } : { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } }
}

export const listProducts = async (query: Record<string, unknown>, user?: AuthUser) => {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20))
    const conditions = user && query.mine === 'true' ? ['p.owner_id = $1'] : ['p.status = \'active\'', 'p.quantity > p.reserved_quantity']
    const parameters: unknown[] = user && query.mine === 'true' ? [user.id] : []
    if (query.ids !== undefined) {
        if (!Array.isArray(query.ids) || query.ids.length > 20000 || query.ids.some(id => typeof id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id))) return invalid(['ids'])
        parameters.push(query.ids); conditions.push(`p.id = ANY($${parameters.length}::uuid[])`)
    }
    if (typeof query.ownerUsername === 'string' && query.ownerUsername.trim()) { parameters.push(query.ownerUsername.trim().toLowerCase()); conditions.push(`u.username_normalized = $${parameters.length}`) }
    if (typeof query.categoryId === 'string' && query.categoryId) { parameters.push(query.categoryId); conditions.push(categoryFilterSql('p.category_id', parameters.length)) }
    if (query.settlementCode !== undefined) {
        const settlement = getSettlement(query.settlementCode)
        if (!settlement) return invalid(['settlementCode'])
        conditions.push(settlementCondition('p.settlement_code', 'p.geo_zone', { settlementCode: settlement.code, cityName: settlement.name }, parameters))
    }
    if (typeof query.region === 'string' && query.region.trim()) {
        const region = query.region.trim()
        if (!settlementCodesInRegion(region).length) return invalid(['region'])
        conditions.push(regionCondition('p.settlement_code', 'p.geo_zone', region, parameters))
    }
    if (typeof query.geoZone === 'string' && query.geoZone.trim()) { parameters.push(query.geoZone.trim()); conditions.push(`p.geo_zone ILIKE $${parameters.length}`) }
    const searchParameterStart = parameters.length
    const search = query.searchIn === 'owner'
        ? null
        : smartSearchSql(listingSearchColumns('product'), typeof query.q === 'string' ? query.q : undefined, parameters, query.searchIn === 'title')
    if (query.searchIn === 'owner') conditions.push(...textSearchConditions(['u.username', 'u.nickname'], typeof query.q === 'string' ? query.q : undefined, parameters))
    if (search) {
        conditions.push(search.condition)
        if (parameters.length === searchParameterStart + 2) conditions.push(`$${parameters.length}::text IS NOT NULL`)
    }
    const sort = query.sort ?? 'default'
    if (typeof sort !== 'string' || !['default', 'newest', 'oldest', 'price_asc', 'price_desc'].includes(sort)) return invalid(['sort'])
    let rateSet = null
    let order = `${search ? `${search.rank} DESC, ` : ''}p.created_at DESC, p.id DESC`
    if (sort === 'newest') order = 'p.created_at DESC, p.id DESC'
    if (sort === 'oldest') order = 'p.created_at ASC, p.id ASC'
    if (sort === 'price_asc' || sort === 'price_desc') {
        if (query.rateId !== undefined && (typeof query.rateId !== 'string' || !/^[a-f0-9]{24}$/.test(query.rateId))) return invalid(['rateId'])
        rateSet = await exchangeRates.get(query.rateId as string | undefined)
        if (!rateSet) return { status: 503, body: { error: 'RATES_UNAVAILABLE', message: 'Сортування за ціною тимчасово недоступне' } }
        const unsupported = await pool.query(`SELECT 1 FROM products p JOIN users u ON u.id = p.owner_id JOIN categories c ON c.id = p.category_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id WHERE ${conditions.join(' AND ')} AND p.price IS NOT NULL AND p.currency NOT IN ('UAH', 'USD', 'EUR', 'PLN') LIMIT 1`, parameters)
        if (unsupported.rowCount) return { status: 503, body: { error: 'RATES_UNAVAILABLE', message: 'Сортування за ціною тимчасово недоступне' } }
        parameters.push(rateSet.rates.USD, rateSet.rates.EUR, rateSet.rates.PLN)
        const n = parameters.length
        const expression = `CASE p.currency WHEN 'UAH' THEN p.price WHEN 'USD' THEN p.price * $${n-2}::numeric WHEN 'EUR' THEN p.price * $${n-1}::numeric WHEN 'PLN' THEN p.price * $${n}::numeric ELSE NULL END`
        order = `${expression} ${sort === 'price_asc' ? 'ASC' : 'DESC'} NULLS LAST, p.id ASC`
    }
    const where = conditions.join(' AND ')
    const countParameters = sort === 'price_asc' || sort === 'price_desc' ? parameters.slice(0, -3) : [...parameters]
    parameters.push(limit, (page - 1) * limit)
    const rows = await pool.query<ProductRow>(`${productSelect} WHERE ${where} ORDER BY ${order} LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`, parameters)
    const photosByProduct = new Map<string, PhotoRow[]>()
    if (rows.rows.length) {
        const photos = await pool.query<PhotoRow & { product_id: string }>('SELECT product_id, id, storage_key, url, alt, sort_order FROM product_photos WHERE product_id = ANY($1::uuid[]) ORDER BY product_id, sort_order, id', [rows.rows.map(row => row.id)])
        for (const photo of photos.rows) {
            const group = photosByProduct.get(photo.product_id)
            if (group) group.push(photo)
            else photosByProduct.set(photo.product_id, [photo])
        }
    }
    const products = rows.rows.map(row => ({ ...row, photos: photosByProduct.get(row.id) ?? [] }))
    const total = rows.rows.length ? Number(rows.rows[0].total_count) : page === 1 ? 0 : Number((await pool.query<{ count: string }>(`SELECT count(*) FROM products p JOIN users u ON u.id = p.owner_id JOIN categories c ON c.id = p.category_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id WHERE ${where}`, countParameters)).rows[0].count)
    return { status: 200, body: { products: products.map((product) => toProductDto(product, product.owner_id === user?.id)), pagination: { page, limit, total, pages: Math.ceil(total / limit) }, ...(rateSet ? { rateSet } : {}) } }
}

export const updateProduct = async (user: AuthUser, id: string, input: Record<string, unknown>) => {
    if ('geoZone' in input && !('settlementCode' in input)) input = { ...input, settlementCode: null }
    if (getSettlement(input.settlementCode) && !('geoZone' in input)) input = { ...input, geoZone: getSettlement(input.settlementCode)!.name }
    const errors = validateProductInput(input, true)
    if (errors.length) return invalid(errors)
    const allowed: Record<string, string> = { categoryId: 'category_id', title: 'title', description: 'description', attributes: 'attributes', quantity: 'quantity', unit: 'unit', price: 'price', currency: 'currency', deliveryMode: 'delivery_mode', deliveryOptions: 'delivery_options', geoZone: 'geo_zone', settlementCode: 'settlement_code', address: 'pickup_address', addressVisibility: 'address_visibility', mapLocationMode: 'map_location_mode', latitude: 'latitude', longitude: 'longitude', status: 'status', expiresAt: 'expires_at' }
    const entries = Object.entries(input).filter(([key]) => key in allowed)
    if (!entries.length && !('photos' in input)) return invalid(['product'])
    const client = await pool.connect()
    const storedPhotos: StoredPhoto[] = []
    let categoryWarning: Awaited<ReturnType<typeof assessCategory>> | null = null
    try {
        await client.query('BEGIN')
        const owner = await client.query('SELECT category_id, title, description, attributes, unit, status, quantity, reserved_quantity, delivery_mode, delivery_options, settlement_code, geo_zone, latitude, longitude, COALESCE(round($3::numeric, 3), quantity) > reserved_quantity AS has_available_quantity FROM products WHERE id = $1 AND owner_id = $2 FOR UPDATE', [id, user.id, input.quantity ?? null])
        if (!owner.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } } }
        if (input.unit !== undefined && input.unit !== owner.rows[0].unit && Number(owner.rows[0].reserved_quantity) > 0) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'PRODUCT_UNIT_RESERVED', message: 'Неможливо змінити одиницю виміру, поки товар зарезервовано в угодах.' } } }
        if (input.quantity !== undefined && Math.round(Number(input.quantity) * 1000) < Math.round(Number(owner.rows[0].reserved_quantity) * 1000)) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'PRODUCT_QUANTITY_RESERVED' } } }
        if (input.deliveryOptions !== undefined && !postalTermsDefined(input.deliveryOptions as DeliveryOption[], owner.rows[0].delivery_options)) { await client.query('ROLLBACK'); return invalid(['deliveryOptions']) }
        if (input.deliveryMode === 'carrier') {
            const oldOptions = owner.rows[0].delivery_options as DeliveryOption[] | null
            const effectiveOptions = input.deliveryOptions === undefined ? oldOptions : input.deliveryOptions as DeliveryOption[]
            const postal = effectiveOptions?.find(option => option.method === 'POSTAL_DELIVERY')
            const oldPostal = oldOptions?.find(option => option.method === 'POSTAL_DELIVERY')
            const unchangedLegacyPostal = oldPostal ? isDeepStrictEqual(oldPostal, postal) : input.deliveryOptions === undefined && owner.rows[0].delivery_mode === 'carrier'
            if (!postal?.postalOperators?.length && !unchangedLegacyPostal) { await client.query('ROLLBACK'); return invalid(['deliveryOptions']) }
        }
        if (input.deliveryOptions !== undefined && !await verifiedDeliveryOptions(input.deliveryOptions as ProductInput['deliveryOptions'])) { await client.query('ROLLBACK'); return invalid(['deliveryOptions']) }
        if (['settlementCode', 'geoZone', 'latitude', 'longitude'].some(key => key in input)) {
            const previous = owner.rows[0]
            if (!await verifiedInputPoint({ settlementCode: input.settlementCode === undefined ? previous.settlement_code : input.settlementCode,
                label: input.geoZone === undefined ? previous.geo_zone : input.geoZone,
                latitude: input.latitude === undefined ? numberOrNull(previous.latitude) : input.latitude,
                longitude: input.longitude === undefined ? numberOrNull(previous.longitude) : input.longitude })) { await client.query('ROLLBACK'); return invalid(['latitude', 'longitude']) }
        }
        if (input.categoryId !== undefined && !(await categoryExists(client, input.categoryId as string))) {
            await client.query('ROLLBACK')
            return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE', message: 'Категорія недоступна' } }
        }
        if ((input.attributes !== undefined || input.categoryId !== undefined) && !await validateAttributes(String(input.categoryId ?? owner.rows[0].category_id), input.attributes === undefined ? owner.rows[0].attributes : input.attributes, client)) { await client.query('ROLLBACK'); return invalid(['attributes']) }
        const previousProduct = owner.rows[0]
        if (input.status === 'active' && !previousProduct.has_available_quantity) {
            await client.query('ROLLBACK')
            return { status: 409, body: { error: 'PRODUCT_NO_AVAILABLE_QUANTITY', message: 'Щоб знову продавати товар, спочатку вкажіть доступну кількість' } }
        }
        if (['categoryId', 'title', 'description', 'unit', 'status'].some(key => key in input)) {
            const assessment = await assessCategory({
                title: String(input.title ?? previousProduct.title), description: String(input.description ?? previousProduct.description),
                categoryId: String(input.categoryId ?? previousProduct.category_id), unit: String(input.unit ?? previousProduct.unit),
            }, client)
            if (assessment.level === 'warn') categoryWarning = assessment
        }
        await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [user.id])
        const duplicates = (input.status ?? previousProduct.status) === 'active' && ['categoryId', 'title', 'description', 'status'].some(key => key in input)
            ? await categoryDuplicates(client, 'product', user.id, String(input.title ?? previousProduct.title), String(input.description ?? previousProduct.description), String(input.categoryId ?? previousProduct.category_id), id) : null
        if (duplicates?.massAbuse) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'CATEGORY_DUPLICATE_ABUSE', message: 'Однакове оголошення вже розміщено в кількох категоріях.', duplicate: duplicates.notice } } }
        if (entries.length) {
            const values = entries.map(([key, value]) => key === 'deliveryOptions' || key === 'attributes' ? JSON.stringify(value) : value)
            const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`)
            values.push(id, user.id)
            await client.query(`UPDATE products SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND owner_id = $${values.length}`, values)
        }
        if (duplicates?.notice) await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_duplicate', 'product', id, JSON.stringify(duplicates.notice)])
        if (categoryWarning) await client.query('INSERT INTO audit_logs (actor_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5)', [user.id, 'listing.category_warning', 'product', id, JSON.stringify({ suggestions: categoryWarning.suggestions })])
        if ('photos' in input) {
            const oldPhotos = await client.query<PhotoRow>('SELECT id, storage_key, url, alt, sort_order FROM product_photos WHERE product_id = $1 ORDER BY sort_order, id', [id])
            const photos = input.photos as NonNullable<ProductInput['photos']>
            if (photos.some(photo => photo.url && !oldPhotos.rows.some(old => old.url === photo.url))) {
                await client.query('ROLLBACK')
                return invalid(['photos'])
            }
            const rows: { storageKey: string; url: string; alt: string }[] = []
            for (const [index, photo] of photos.entries()) {
                const old = photo.url ? oldPhotos.rows.find(item => item.url === photo.url) : undefined
                if (old) rows.push({ storageKey: old.storage_key, url: old.url, alt: photo.alt ?? old.alt })
                else {
                    const saved = await photoStorage.store(`${id}/${randomUUID()}`, photo, index)
                    storedPhotos.push(saved)
                    rows.push({ ...saved, alt: photo.alt ?? '' })
                }
            }
            await client.query('DELETE FROM product_photos WHERE product_id = $1', [id])
            for (const [index, photo] of rows.entries()) await client.query('INSERT INTO product_photos (product_id, storage_key, url, alt, sort_order) VALUES ($1, $2, $3, $4, $5)', [id, photo.storageKey, photo.url, photo.alt, index])
        }
        const updated = await getProductRow(client, id, user.id)
        await client.query('COMMIT')
        return updated ? { status: 200, body: { product: toProductDto(updated, true), ...(categoryWarning ? { categoryWarning } : {}), ...(duplicates?.notice ? { duplicate: duplicates.notice } : {}) } } : { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } }
    } catch (error) { await client.query('ROLLBACK'); for (const photo of storedPhotos) await photoStorage.remove(photo.storageKey); throw error } finally { client.release() }
}

export const deleteProduct = async (user: AuthUser, id: string) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        const lockedProduct = await client.query('SELECT id FROM products WHERE id = $1 AND owner_id = $2 FOR UPDATE', [id, user.id])
        if (!lockedProduct.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } } }
        const linkedOrders = await client.query('SELECT 1 FROM order_items WHERE product_id = $1 LIMIT 1', [id])
        if (linkedOrders.rowCount) { await client.query('ROLLBACK'); return { status: 409, body: { error: 'PRODUCT_HAS_ORDER_HISTORY' } } }
        const photos = await client.query<PhotoRow>(
            'SELECT storage_key FROM product_photos WHERE product_id = $1 AND EXISTS (SELECT 1 FROM products WHERE id = $1 AND owner_id = $2)',
            [id, user.id],
        )
        const result = await client.query('DELETE FROM products WHERE id = $1 AND owner_id = $2', [id, user.id])
        if (!result.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } } }
        await client.query('COMMIT')
        for (const photo of photos.rows) await photoStorage.remove(photo.storage_key)
        return { status: 204, body: null }
    } catch (error) { await client.query('ROLLBACK'); throw error } finally { client.release() }
}
