import type { PoolClient } from 'pg'
import { pool } from './db/client.js'
import { categoryFilterSql } from './category-filter.js'
import { textSearchConditions } from './text-search.js'

export type MapPoint = { latitude: number; longitude: number }
export type MapViewport = { south: number; north: number; west: number; east: number }
export type MapFilterState = { categoryId?: string; geoZone?: string; q?: string; searchIn?: 'title' | 'all' | 'owner'; viewport?: MapViewport; radiusKm: number; showProducts: boolean; showBuyRequests: boolean; mapCenter?: MapPoint }
export type MapMarker = MapPoint & {
    id: string
    kind: 'product' | 'buyRequest'
    title: string
    geoZone: string
    category: { id: string; name: string; imageIndex?: number | null }
    photoUrl?: string | null
    price?: { amount: number; currency: string }
    quantity?: number
    unit?: string
    deliveryMode?: string
    owner?: { id: string; username: string; nickname: string | null; avatarUrl: string | null }
    approximate: true
    distanceKm: number
}

export interface MapProviderAdapter {
    toProviderPoint(point: MapPoint): unknown
    fromProviderPoint(point: unknown): MapPoint | null
}

export const DEFAULT_RADIUS_KM = 25
export const MIN_RADIUS_KM = 1
export const MAX_RADIUS_KM = 200

export const clampRadius = (radius: number | string | undefined) => {
    const value = typeof radius === 'string' ? Number(radius) : radius ?? DEFAULT_RADIUS_KM
    return Number.isFinite(value) ? Math.min(MAX_RADIUS_KM, Math.max(MIN_RADIUS_KM, value)) : DEFAULT_RADIUS_KM
}

export const adaptiveRadius = (requestedRadius: number | string | undefined, zoom?: number | string) => {
    const radius = clampRadius(requestedRadius)
    const numericZoom = typeof zoom === 'string' ? Number(zoom) : zoom
    if (numericZoom === undefined || !Number.isFinite(numericZoom)) return radius
    if (numericZoom >= 13) return Math.min(radius, 10)
    if (numericZoom <= 8) return Math.max(radius, 50)
    return radius
}

export const approximatePoint = (point: MapPoint, precision = 2): MapPoint => {
    const factor = 10 ** precision
    return { latitude: Math.round(point.latitude * factor) / factor, longitude: Math.round(point.longitude * factor) / factor }
}

export const syncMapFilters = (filters: Partial<MapFilterState>, mapCenter?: MapPoint): MapFilterState => ({
    categoryId: filters.categoryId || undefined,
    geoZone: filters.geoZone?.trim() || undefined,
    radiusKm: clampRadius(filters.radiusKm),
    showProducts: filters.showProducts ?? true,
    showBuyRequests: filters.showBuyRequests ?? true,
    ...(mapCenter ? { mapCenter } : {}),
    ...(filters.q?.trim() ? { q: filters.q.trim() } : {}),
    ...(filters.searchIn ? { searchIn: filters.searchIn } : {}),
    ...(filters.viewport ? { viewport: filters.viewport } : {}),
})

const distanceSql = (table: string) =>
    `6371 * acos(LEAST(1, GREATEST(-1, cos(radians($1)) * cos(radians(${table}.latitude)) * cos(radians(${table}.longitude) - radians($2)) + sin(radians($1)) * sin(radians(${table}.latitude)))))`

type Queryable = Pick<PoolClient, 'query'>

export function viewportConditions(table: string, viewport: MapViewport | undefined, parameters: unknown[], precision?: string) {
    if (!viewport) return []
    // Match the public marker, not the private address that may be outside a zoomed viewport.
    const coordinate = (axis: string) => precision === undefined ? `${table}.${axis}` : `(floor(${table}.${axis} * power(10::numeric, ${precision}) + 0.5) / power(10::numeric, ${precision}))`
    const latitude = coordinate('latitude'), longitude = coordinate('longitude')
    const south = parameters.push(viewport.south), north = parameters.push(viewport.north)
    const west = parameters.push(viewport.west), east = parameters.push(viewport.east)
    return [`${latitude} BETWEEN $${south} AND $${north}`, viewport.west > viewport.east
        ? `(${longitude} >= $${west} OR ${longitude} <= $${east})`
        : `${longitude} BETWEEN $${west} AND $${east}`]
}

export class MapService {
    constructor(private readonly queryable: Queryable = pool) { }

    async findMarkers(center: MapPoint, options: Partial<MapFilterState> = {}): Promise<MapMarker[]> {
        const filters = syncMapFilters(options)
        const markers: MapMarker[] = []
        if (filters.showProducts) markers.push(...await this.products(center, filters))
        if (filters.showBuyRequests) markers.push(...await this.buyRequests(center, filters))
        return markers.sort((left, right) => left.distanceKm - right.distanceKm)
    }

    private async products(center: MapPoint, filters: MapFilterState): Promise<MapMarker[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const conditions = [`p.status = 'active'`, `${distanceSql('p')} <= $3`, 'p.latitude IS NOT NULL', 'p.longitude IS NOT NULL']
        conditions.push(...viewportConditions('p', filters.viewport, parameters, "CASE WHEN u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%' THEN 5 ELSE 2 END"))
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(categoryFilterSql('p.category_id', parameters.length)) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`p.geo_zone ILIKE $${parameters.length}`) }
        conditions.push(...textSearchConditions(filters.searchIn === 'title' ? ['p.title'] : filters.searchIn === 'owner' ? ['u.username', 'u.nickname'] : ['p.title', 'p.description', 'u.username', 'u.nickname'], filters.q, parameters))
        const result = await this.queryable.query(`SELECT p.id, p.title, p.geo_zone, p.latitude, p.longitude, p.category_id, c.name AS category_name, c.image_index, p.price, p.currency, p.quantity, p.reserved_quantity, p.unit, p.delivery_mode,
            u.id AS owner_id, u.username AS owner_username, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar_url,
            (u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%') AS is_demo,
            photo.url AS photo_url, ${distanceSql('p')} AS distance_km
            FROM products p JOIN categories c ON c.id = p.category_id JOIN users u ON u.id = p.owner_id
            LEFT JOIN LATERAL (SELECT url FROM product_photos WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) photo ON true
            WHERE ${conditions.join(' AND ')}`, parameters)
        return result.rows.map((row) => this.marker(row, 'product'))
    }

    private async buyRequests(center: MapPoint, filters: MapFilterState): Promise<MapMarker[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const conditions = [`r.status IN ('open', 'partially_fulfilled')`, `${distanceSql('r')} <= $3`, 'r.latitude IS NOT NULL', 'r.longitude IS NOT NULL']
        conditions.push(...viewportConditions('r', filters.viewport, parameters, '2'))
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(categoryFilterSql('r.category_id', parameters.length)) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`r.geo_area ILIKE $${parameters.length}`) }
        conditions.push(...textSearchConditions(filters.searchIn === 'title' ? ['r.title'] : filters.searchIn === 'owner' ? ['u.username', 'u.nickname'] : ['r.title', 'r.description', 'u.username', 'u.nickname'], filters.q, parameters))
        const result = await this.queryable.query(`SELECT r.id, r.title, r.geo_area, r.latitude, r.longitude, r.category_id, c.name AS category_name, c.image_index,
            u.id AS owner_id, u.username AS owner_username, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar_url,
            ${distanceSql('r')} AS distance_km FROM buy_requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.buyer_id WHERE ${conditions.join(' AND ')}`, parameters)
        return result.rows.map((row) => this.marker(row, 'buyRequest'))
    }

    private marker(row: any, kind: MapMarker['kind']): MapMarker {
        // Detailed demo positions are safe; real users retain the existing privacy rounding.
        const point = approximatePoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) }, row.is_demo ? 5 : 2)
        return { id: row.id, kind, title: row.title, geoZone: row.geo_zone ?? row.geo_area, category: { id: row.category_id, name: row.category_name, imageIndex: row.image_index }, ...(row.owner_id ? { owner: { id: row.owner_id, username: row.owner_username, nickname: row.owner_nickname ?? null, avatarUrl: row.owner_avatar_url ?? null } } : {}), ...(kind === 'product' ? { photoUrl: row.photo_url ?? null, price: { amount: Number(row.price), currency: row.currency }, quantity: Number(row.quantity) - Number(row.reserved_quantity ?? 0), unit: row.unit, deliveryMode: row.delivery_mode } : {}), ...point, approximate: true, distanceKm: Number(Number(row.distance_km).toFixed(2)) }
    }
}
