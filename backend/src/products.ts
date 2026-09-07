import type { PoolClient } from 'pg'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { ExternalUrlPhotoStorage, type PhotoStorage, type StoredPhoto } from './photo-storage.js'
import { validateProductInput, type ProductInput, type ProductStatus } from './product-validation.js'

type ProductRow = {
    id: string; owner_id: string; owner_username: string; category_id: string; category_code: string; category_name: string
    title: string; description: string; quantity: string | number; unit: string; price: string | number; currency: string
    delivery_mode: string; geo_zone: string; latitude: string | number | null; longitude: string | number | null
    status: ProductStatus; expires_at: Date | null; created_at: Date; updated_at: Date
}
type PhotoRow = { id: string; storage_key: string; url: string; alt: string; sort_order: number }
type ProductWithPhotos = ProductRow & { photos: PhotoRow[] }
type Queryable = Pick<PoolClient, 'query'>

export const photoStorage: PhotoStorage = new ExternalUrlPhotoStorage()

const numberOrNull = (value: string | number | null) => value === null ? null : Number(value)
const toPhotoDto = (photo: PhotoRow) => ({ id: photo.id, url: photo.url, alt: photo.alt, order: photo.sort_order })
export const toProductDto = (row: ProductWithPhotos) => ({
    id: row.id,
    owner: { id: row.owner_id, username: row.owner_username },
    category: { id: row.category_id, code: row.category_code, name: row.category_name },
    title: row.title,
    description: row.description,
    photos: row.photos.map(toPhotoDto),
    quantity: Number(row.quantity),
    unit: row.unit,
    price: { amount: Number(row.price), currency: row.currency },
    deliveryMode: row.delivery_mode,
    geoZone: row.geo_zone,
    coordinates: row.latitude === null || row.longitude === null ? null : { latitude: Number(row.latitude), longitude: Number(row.longitude) },
    status: row.status,
    expiresAt: row.expires_at?.toISOString() ?? null,
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
})

const productSelect = `
    SELECT p.id, p.owner_id, u.username AS owner_username, p.category_id, c.code AS category_code, c.name AS category_name,
           p.title, p.description, p.quantity, p.unit, p.price, p.currency, p.delivery_mode, p.geo_zone,
           p.latitude, p.longitude, p.status, p.expires_at, p.created_at, p.updated_at
    FROM products p JOIN users u ON u.id = p.owner_id JOIN categories c ON c.id = p.category_id`

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

const writePhotos = async (queryable: Queryable, productId: string, photos: ProductInput['photos'] = []): Promise<StoredPhoto[]> => {
    const storedPhotos: StoredPhoto[] = []
    for (const [index, photo] of photos.entries()) {
        const stored = await photoStorage.store(productId, photo, index)
        storedPhotos.push(stored)
        await queryable.query(
            'INSERT INTO product_photos (product_id, storage_key, url, alt, sort_order) VALUES ($1, $2, $3, $4, $5)',
            [productId, stored.storageKey, stored.url, photo.alt ?? '', index],
        )
    }
    return storedPhotos
}

const invalid = (fields: string[]) => ({ status: 400, body: { error: 'VALIDATION_ERROR', message: 'Перевірте дані товару', fields } })

export const listCategories = async () => {
    const result = await pool.query('SELECT id, parent_id AS "parentId", code, name, path FROM categories WHERE is_active ORDER BY path, name')
    return { status: 200, body: { categories: result.rows } }
}

export const createProduct = async (user: AuthUser, input: Record<string, unknown>) => {
    const errors = validateProductInput(input)
    if (errors.length) return invalid(errors)
    if (!(await categoryExists(pool, input.categoryId as string))) return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE', message: 'Категорія недоступна' } }
    const product = input as unknown as ProductInput
    const client = await pool.connect()
    let storedPhotos: StoredPhoto[] = []
    try {
        await client.query('BEGIN')
        const result = await client.query<ProductRow>(
            `INSERT INTO products (owner_id, category_id, title, description, quantity, unit, price, currency, delivery_mode, geo_zone, latitude, longitude, status, expires_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING id`,
            [user.id, product.categoryId, product.title.trim(), product.description ?? '', product.quantity, product.unit, product.price, product.currency, product.deliveryMode, product.geoZone.trim(), product.latitude ?? null, product.longitude ?? null, product.status ?? 'draft', product.expiresAt ?? null],
        )
        storedPhotos = await writePhotos(client, result.rows[0].id, product.photos)
        const created = await getProductRow(client, result.rows[0].id, user.id)
        await client.query('COMMIT')
        return { status: 201, body: { product: toProductDto(created!) } }
    } catch (error) {
        await client.query('ROLLBACK')
        for (const photo of storedPhotos) await photoStorage.remove(photo.storageKey)
        throw error
    } finally { client.release() }
}

export const getProduct = async (id: string, user?: AuthUser) => {
    const product = await getProductRow(pool, id, user?.id)
    return product ? { status: 200, body: { product: toProductDto(product) } } : { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } }
}

export const listProducts = async (query: Record<string, unknown>, user?: AuthUser) => {
    const page = Math.max(1, Number.parseInt(String(query.page ?? '1'), 10) || 1)
    const limit = Math.min(50, Math.max(1, Number.parseInt(String(query.limit ?? '20'), 10) || 20))
    const conditions = user && query.mine === 'true' ? ['p.owner_id = $1'] : ['p.status = \'active\'']
    const parameters: unknown[] = user && query.mine === 'true' ? [user.id] : []
    if (typeof query.categoryId === 'string') { parameters.push(query.categoryId); conditions.push(`p.category_id = $${parameters.length}`) }
    if (typeof query.geoZone === 'string' && query.geoZone.trim()) { parameters.push(query.geoZone.trim()); conditions.push(`p.geo_zone ILIKE $${parameters.length}`) }
    const where = conditions.join(' AND ')
    const count = await pool.query<{ count: string }>(`SELECT count(*) FROM products p WHERE ${where}`, parameters)
    parameters.push(limit, (page - 1) * limit)
    const rows = await pool.query<ProductRow>(`${productSelect} WHERE ${where} ORDER BY p.created_at DESC, p.id DESC LIMIT $${parameters.length - 1} OFFSET $${parameters.length}`, parameters)
    const products = await Promise.all(rows.rows.map(async (row) => ({ ...row, photos: (await pool.query<PhotoRow>('SELECT id, storage_key, url, alt, sort_order FROM product_photos WHERE product_id = $1 ORDER BY sort_order, id', [row.id])).rows })))
    const total = Number(count.rows[0].count)
    return { status: 200, body: { products: products.map(toProductDto), pagination: { page, limit, total, pages: Math.ceil(total / limit) } } }
}

export const updateProduct = async (user: AuthUser, id: string, input: Record<string, unknown>) => {
    const errors = validateProductInput(input, true)
    if (errors.length) return invalid(errors)
    const allowed: Record<string, string> = { categoryId: 'category_id', title: 'title', description: 'description', quantity: 'quantity', unit: 'unit', price: 'price', currency: 'currency', deliveryMode: 'delivery_mode', geoZone: 'geo_zone', latitude: 'latitude', longitude: 'longitude', status: 'status', expiresAt: 'expires_at' }
    const entries = Object.entries(input).filter(([key]) => key in allowed)
    if (!entries.length && !('photos' in input)) return invalid(['product'])
    const client = await pool.connect()
    let storedPhotos: StoredPhoto[] = []
    try {
        await client.query('BEGIN')
        const owner = await client.query('SELECT 1 FROM products WHERE id = $1 AND owner_id = $2 FOR UPDATE', [id, user.id])
        if (!owner.rowCount) { await client.query('ROLLBACK'); return { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } } }
        if (input.categoryId !== undefined && !(await categoryExists(client, input.categoryId as string))) {
            await client.query('ROLLBACK')
            return { status: 400, body: { error: 'CATEGORY_NOT_AVAILABLE', message: 'Категорія недоступна' } }
        }
        if (entries.length) {
            const values = entries.map(([, value]) => value)
            const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`)
            values.push(id, user.id)
            await client.query(`UPDATE products SET ${assignments.join(', ')}, updated_at = now() WHERE id = $${values.length - 1} AND owner_id = $${values.length}`, values)
        }
        if ('photos' in input) {
            const oldPhotos = await client.query<PhotoRow>('SELECT storage_key FROM product_photos WHERE product_id = $1', [id])
            await client.query('DELETE FROM product_photos WHERE product_id = $1 AND EXISTS (SELECT 1 FROM products WHERE id = $1 AND owner_id = $2)', [id, user.id])
            for (const photo of oldPhotos.rows) await photoStorage.remove(photo.storage_key)
            storedPhotos = await writePhotos(client, id, input.photos as ProductInput['photos'])
        }
        const updated = await getProductRow(client, id, user.id)
        await client.query('COMMIT')
        return updated ? { status: 200, body: { product: toProductDto(updated) } } : { status: 404, body: { error: 'PRODUCT_NOT_FOUND' } }
    } catch (error) { await client.query('ROLLBACK'); for (const photo of storedPhotos) await photoStorage.remove(photo.storageKey); throw error } finally { client.release() }
}

export const deleteProduct = async (user: AuthUser, id: string) => {
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
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
