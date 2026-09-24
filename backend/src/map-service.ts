import type { PoolClient } from 'pg'
import { pool } from './db/client.js'
import { categoryFilterSql } from './category-filter.js'
import { textSearchConditions } from './text-search.js'
import { withinCityOrDistance, type CityBoundary } from './city-boundaries.js'
import { getSettlement } from './settlements.js'

export type MapPoint = { latitude: number; longitude: number }
export type MapViewport = { south: number; north: number; west: number; east: number }
export type MapFilterState = { nationwide?: boolean; includeOwnerListings?: boolean; exactDistance?: boolean; settlementCode?: string; geoSettlementCode?: string; cityName?: string; cityBoundary?: CityBoundary; cityOutsideKm?: number; categoryId?: string; geoZone?: string; q?: string; searchIn?: 'title' | 'all' | 'owner'; viewport?: MapViewport; radiusKm: number; showProducts: boolean; showBuyRequests: boolean; mapCenter?: MapPoint }
export type MapMarker = MapPoint & {
    id: string
    kind: 'product' | 'buyRequest'
    title: string
    geoZone: string
    category: { id: string; name: string; imageIndex?: number | null }
    photoUrl?: string | null
    publicAddress?: string
    price?: { amount: number; currency: string }
    quantity?: number
    unit?: string
    deliveryMode?: string
    owner?: { id: string; username: string; nickname: string | null; avatarUrl: string | null }
    approximate: boolean
    distanceBand: string
}

export interface MapProviderAdapter {
    toProviderPoint(point: MapPoint): unknown
    fromProviderPoint(point: unknown): MapPoint | null
}

export const DEFAULT_RADIUS_KM = 25
export const MIN_RADIUS_KM = .2
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
    ...(filters.cityName?.trim() ? { cityName: filters.cityName.trim() } : {}),
    ...(filters.settlementCode ? { settlementCode: filters.settlementCode } : {}),
    ...(filters.geoSettlementCode ? { geoSettlementCode: filters.geoSettlementCode } : {}),
    ...(filters.cityBoundary ? { cityBoundary: filters.cityBoundary } : {}),
    ...(filters.cityOutsideKm !== undefined ? { cityOutsideKm: filters.cityOutsideKm } : {}),
    ...(filters.nationwide ? { nationwide: true } : {}),
    ...(filters.includeOwnerListings ? { includeOwnerListings: true } : {}),
    ...(filters.exactDistance ? { exactDistance: true } : {}),
})

const distanceSql = (table: string) =>
    `6371 * acos(LEAST(1, GREATEST(-1, cos(radians($1)) * cos(radians(${table}.latitude)) * cos(radians(${table}.longitude) - radians($2)) + sin(radians($1)) * sin(radians(${table}.latitude)))))`

type Queryable = Pick<PoolClient, 'query'>

export function cityCondition(column: string, cityName: string, parameters: unknown[]) {
    const index = parameters.push(cityName.trim().replace(/^(?:(?:місто|селище|село)\s+|(?:смт\.?|м\.|с\.|с-ще)\s*)/iu, '').toLocaleLowerCase('uk-UA'))
    return `lower(regexp_replace(trim(${column}), '^((місто|селище|село)[[:space:]]+|(смт[.]?|м[.]|с[.]|с-ще)[[:space:]]*)', '', 'i')) = $${index}`
}

export function settlementCondition(codeColumn: string, nameColumn: string, filters: Pick<MapFilterState, 'cityName' | 'settlementCode'>, parameters: unknown[]) {
    const nameMatch = cityCondition(nameColumn, filters.cityName!, parameters)
    if (!filters.settlementCode) return nameMatch
    const index = parameters.push(filters.settlementCode)
    return `(${codeColumn} = $${index} OR (${codeColumn} IS NULL AND ${nameMatch}))`
}

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
        return markers.filter(marker => !filters.cityBoundary || withinCityOrDistance(marker, filters.cityBoundary, filters.cityOutsideKm ?? 0)).sort((left, right) => left.title.localeCompare(right.title, 'uk'))
    }

    private async products(center: MapPoint, filters: MapFilterState): Promise<MapMarker[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const distancePoint = filters.exactDistance ? 'p' : 'public_point'
        const conditions = [`p.status = 'active'`, filters.nationwide || filters.includeOwnerListings ? '$3::numeric IS NOT NULL' : `${distanceSql(distancePoint)} <= $3`, 'public_point.latitude IS NOT NULL', 'public_point.longitude IS NOT NULL']
        if (filters.cityName && !filters.cityBoundary) {
            const match = settlementCondition('public_point.settlement_code', 'public_point.geo_zone', filters, parameters)
            conditions.push(filters.cityOutsideKm !== undefined ? `(${match} OR ${distanceSql('public_point')} <= $3)` : match)
        }
        conditions.push(...viewportConditions('public_point', filters.viewport, parameters))
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(categoryFilterSql('p.category_id', parameters.length)) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`public_point.geo_zone ILIKE $${parameters.length}`) }
        if (filters.geoSettlementCode) conditions.push(settlementCondition('public_point.settlement_code', 'public_point.geo_zone', { settlementCode: filters.geoSettlementCode, cityName: getSettlement(filters.geoSettlementCode)!.name }, parameters))
        conditions.push(...textSearchConditions(filters.searchIn === 'title' ? ['p.title'] : filters.searchIn === 'owner' ? ['u.username', 'u.nickname'] : ['p.title', 'p.description', 'u.username', 'u.nickname'], filters.q, parameters))
        const result = await this.queryable.query(`SELECT p.id, p.title, public_point.geo_zone, public_point.latitude, public_point.longitude, p.category_id, c.name AS category_name, c.image_index, p.price, p.currency, p.quantity, p.reserved_quantity, p.unit, p.delivery_mode,
            (p.map_location_mode IN ('pin', 'address') OR p.address_visibility = 'public' OR (p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))))) AS is_public_point,
            CASE WHEN p.address_visibility = 'public' THEN p.pickup_address WHEN p.map_location_mode = 'profile' AND u.map_location_mode = 'address' THEN u.exact_address ELSE NULL END AS public_address,
            u.id AS owner_id, u.username AS owner_username, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar_url,
            (u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%') AS is_demo,
            photo.url AS photo_url, ${distanceSql(distancePoint)} AS distance_km
            FROM products p JOIN categories c ON c.id = p.category_id JOIN users u ON u.id = p.owner_id
            CROSS JOIN LATERAL (SELECT CASE WHEN u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%' THEN 100000::numeric ELSE 100::numeric END AS factor) privacy
            CROSS JOIN LATERAL (SELECT
                CASE WHEN p.map_location_mode IN ('pin', 'address') OR p.address_visibility = 'public' THEN p.latitude WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN u.public_latitude ELSE floor(p.latitude * privacy.factor + 0.5) / privacy.factor END AS latitude,
                CASE WHEN p.map_location_mode IN ('pin', 'address') OR p.address_visibility = 'public' THEN p.longitude WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN u.public_longitude ELSE floor(p.longitude * privacy.factor + 0.5) / privacy.factor END AS longitude,
                CASE WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN COALESCE(NULLIF(u.location_display, ''), p.geo_zone) ELSE p.geo_zone END AS geo_zone,
                CASE WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN u.settlement_code ELSE p.settlement_code END AS settlement_code
            ) public_point
            LEFT JOIN LATERAL (SELECT url FROM product_photos WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) photo ON true
            WHERE ${conditions.join(' AND ')}`, parameters)
        return result.rows.map((row) => this.marker(row, 'product'))
    }

    private async buyRequests(center: MapPoint, filters: MapFilterState): Promise<MapMarker[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const distancePoint = filters.exactDistance ? 'r' : 'public_point'
        const conditions = [`r.status IN ('open', 'partially_fulfilled')`, filters.nationwide || filters.includeOwnerListings ? '$3::numeric IS NOT NULL' : `${distanceSql(distancePoint)} <= $3`, 'public_point.latitude IS NOT NULL', 'public_point.longitude IS NOT NULL']
        if (filters.cityName && !filters.cityBoundary) {
            const match = settlementCondition('public_point.settlement_code', 'public_point.geo_area', filters, parameters)
            conditions.push(filters.cityOutsideKm !== undefined ? `(${match} OR ${distanceSql('public_point')} <= $3)` : match)
        }
        conditions.push(...viewportConditions('public_point', filters.viewport, parameters))
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(categoryFilterSql('r.category_id', parameters.length)) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`public_point.geo_area ILIKE $${parameters.length}`) }
        if (filters.geoSettlementCode) conditions.push(settlementCondition('public_point.settlement_code', 'public_point.geo_area', { settlementCode: filters.geoSettlementCode, cityName: getSettlement(filters.geoSettlementCode)!.name }, parameters))
        conditions.push(...textSearchConditions(filters.searchIn === 'title' ? ['r.title'] : filters.searchIn === 'owner' ? ['u.username', 'u.nickname'] : ['r.title', 'r.description', 'u.username', 'u.nickname'], filters.q, parameters))
        const result = await this.queryable.query(`SELECT r.id, r.title, public_point.geo_area, public_point.latitude, public_point.longitude, r.category_id, c.name AS category_name, c.image_index,
            u.id AS owner_id, u.username AS owner_username, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar_url,
            (r.map_location_mode IN ('pin', 'address') OR r.address_visibility = 'public' OR (r.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND r.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(r.geo_area, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(r.geo_area) = lower(u.location_display))))) AS is_public_point,
            CASE WHEN r.address_visibility = 'public' THEN r.delivery_address WHEN r.map_location_mode = 'profile' AND u.map_location_mode = 'address' THEN u.exact_address ELSE NULL END AS public_address,
            ${distanceSql(distancePoint)} AS distance_km FROM buy_requests r JOIN categories c ON c.id = r.category_id JOIN users u ON u.id = r.buyer_id
            CROSS JOIN LATERAL (SELECT CASE WHEN u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%' THEN 100000::numeric ELSE 100::numeric END AS factor) privacy
            CROSS JOIN LATERAL (SELECT
                CASE WHEN r.map_location_mode IN ('pin', 'address') OR r.address_visibility = 'public' THEN r.latitude WHEN r.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND r.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(r.geo_area, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(r.geo_area) = lower(u.location_display))) THEN u.public_latitude ELSE floor(r.latitude * privacy.factor + 0.5) / privacy.factor END AS latitude,
                CASE WHEN r.map_location_mode IN ('pin', 'address') OR r.address_visibility = 'public' THEN r.longitude WHEN r.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND r.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(r.geo_area, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(r.geo_area) = lower(u.location_display))) THEN u.public_longitude ELSE floor(r.longitude * privacy.factor + 0.5) / privacy.factor END AS longitude,
                CASE WHEN r.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND r.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(r.geo_area, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(r.geo_area) = lower(u.location_display))) THEN COALESCE(NULLIF(u.location_display, ''), r.geo_area) ELSE r.geo_area END AS geo_area,
                CASE WHEN r.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND r.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(r.geo_area, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(r.geo_area) = lower(u.location_display))) THEN u.settlement_code ELSE r.settlement_code END AS settlement_code
            ) public_point WHERE ${conditions.join(' AND ')}`, parameters)
        return result.rows.map((row) => this.marker(row, 'buyRequest'))
    }

    private marker(row: any, kind: MapMarker['kind']): MapMarker {
        // Detailed demo positions are safe; real users retain the existing privacy rounding.
        const coordinates = { latitude: Number(row.latitude), longitude: Number(row.longitude) }
        const point = row.is_public_point ? coordinates : approximatePoint(coordinates, row.is_demo ? 5 : 2)
        const distance = Number(row.distance_km)
        const distanceBand = distance <= 1 ? 'до 1 км' : distance <= 3 ? '1–3 км' : distance <= 5 ? '3–5 км' : distance <= 10 ? '5–10 км' : distance <= 20 ? '10–20 км' : 'понад 20 км'
        return { id: row.id, kind, title: row.title, geoZone: row.geo_zone ?? row.geo_area, category: { id: row.category_id, name: row.category_name, imageIndex: row.image_index }, ...(row.owner_id ? { owner: { id: row.owner_id, username: row.owner_username, nickname: row.owner_nickname ?? null, avatarUrl: row.owner_avatar_url ?? null } } : {}), ...(row.public_address ? { publicAddress: row.public_address } : {}), ...(kind === 'product' ? { photoUrl: row.photo_url ?? null, price: { amount: Number(row.price), currency: row.currency }, quantity: Number(row.quantity) - Number(row.reserved_quantity ?? 0), unit: row.unit, deliveryMode: row.delivery_mode } : {}), ...point, approximate: !row.is_public_point, distanceBand }
    }
}
