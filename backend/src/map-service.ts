import type { PoolClient } from 'pg'
import { pool } from './db/client.js'
import { categoryFilterSql } from './category-filter.js'
import { textSearchConditions } from './text-search.js'
import { listingSearchColumns, smartSearchSql } from './smart-search.js'
import { withinCityOrDistance, type CityBoundary } from './city-boundaries.js'
import { getSettlement, settlementCodesInRegion } from './settlements.js'
import { requestPublicLocationSql } from './request-public-location.js'
import type { DeliveryMethod, DeliveryOption } from './delivery-compatibility.js'

export type MapPoint = { latitude: number; longitude: number }
export type MapViewport = { south: number; north: number; west: number; east: number }
export type MapFilterState = { buyRequestIds?: string[]; nationwide?: boolean; includeOwnerListings?: boolean; exactDistance?: boolean; settlementCode?: string; geoSettlementCode?: string; region?: string; cityName?: string; cityBoundary?: CityBoundary; cityOutsideKm?: number; categoryId?: string; deliveryMethod?: DeliveryMethod; geoZone?: string; q?: string; searchIn?: 'title' | 'all' | 'owner'; viewport?: MapViewport; radiusKm: number; showProducts: boolean; showBuyRequests: boolean; mapCenter?: MapPoint }
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
    deliveryOptions?: DeliveryOption[] | null
    owner?: { id: string; username: string; nickname: string | null; avatarUrl: string | null }
    approximate: boolean
    distanceBand: string
    relevance?: number
}

export type MapGeoGroup = {
    id: string
    level: 'region' | 'district' | 'unknown'
    name: string
    latitude: number
    longitude: number
    bounds: MapViewport
    count: number
    productCount: number
    buyRequestCount: number
}

type GeoBucket = { settlement_code: string | null; latitude: string; longitude: string; south: string; north: string; west: string; east: string; count: string }

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
    ...(filters.buyRequestIds ? { buyRequestIds: filters.buyRequestIds } : {}),
    categoryId: filters.categoryId || undefined,
    deliveryMethod: filters.deliveryMethod || undefined,
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
    ...(filters.region?.trim() ? { region: filters.region.trim() } : {}),
    ...(filters.cityBoundary ? { cityBoundary: filters.cityBoundary } : {}),
    ...(filters.cityOutsideKm !== undefined ? { cityOutsideKm: filters.cityOutsideKm } : {}),
    ...(filters.nationwide ? { nationwide: true } : {}),
    ...(filters.includeOwnerListings ? { includeOwnerListings: true } : {}),
    ...(filters.exactDistance ? { exactDistance: true } : {}),
})

const distanceSql = (table: string) =>
    `6371 * acos(LEAST(1, GREATEST(-1, cos(radians($1::numeric)) * cos(radians(${table}.latitude)) * cos(radians(${table}.longitude) - radians($2::numeric)) + sin(radians($1::numeric)) * sin(radians(${table}.latitude)))))`

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

export function regionCondition(codeColumn: string, nameColumn: string, region: string, parameters: unknown[]) {
    const codes = settlementCodesInRegion(region)
    if (!codes.length) return 'false'
    const codesIndex = parameters.push(codes)
    const legacyIndex = parameters.push(region)
    return `(${codeColumn} = ANY($${codesIndex}::text[]) OR (${codeColumn} IS NULL AND lower(trim(${nameColumn})) = lower(trim($${legacyIndex}))))`
}

export function viewportConditions(table: string, viewport: MapViewport | undefined, parameters: unknown[]) {
    if (!viewport) return []
    // Match the public marker, not the private address that may be outside a zoomed viewport.
    const latitude = `${table}.latitude`, longitude = `${table}.longitude`
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
        return markers.filter(marker => !filters.cityBoundary || withinCityOrDistance(marker, filters.cityBoundary, filters.cityOutsideKm ?? 0))
            .sort((left, right) => filters.q && filters.searchIn !== 'owner' ? (right.relevance ?? 0) - (left.relevance ?? 0) || left.title.localeCompare(right.title, 'uk') || left.id.localeCompare(right.id) : left.title.localeCompare(right.title, 'uk'))
    }

    async findGeoGroups(center: MapPoint, options: Partial<MapFilterState>, level: 'region' | 'district'): Promise<MapGeoGroup[]> {
        const filters = syncMapFilters(options)
        const buckets: { kind: MapMarker['kind']; row: GeoBucket }[] = []
        if (filters.showProducts) for (const row of await this.products(center, filters, true)) buckets.push({ kind: 'product', row })
        if (filters.showBuyRequests) for (const row of await this.buyRequests(center, filters, true)) buckets.push({ kind: 'buyRequest', row })
        const groups = new Map<string, MapGeoGroup & { weightedLatitude: number; weightedLongitude: number }>()
        for (const { kind, row } of buckets) {
            const settlement = getSettlement(row.settlement_code)
            const name = settlement ? level === 'region' ? settlement.region : settlement.district || settlement.region : 'Місце без перевіреного району'
            const key = settlement ? level === 'region' ? `region:${settlement.region}` : `district:${settlement.region}:${settlement.district || settlement.region}` : `unknown:${Math.floor(Number(row.latitude) * 2)}:${Math.floor(Number(row.longitude) * 2)}`
            const count = Number(row.count)
            const current = groups.get(key) ?? { id: key, level: settlement ? level : 'unknown', name, latitude: 0, longitude: 0, weightedLatitude: 0, weightedLongitude: 0,
                bounds: { south: Number(row.south), north: Number(row.north), west: Number(row.west), east: Number(row.east) }, count: 0, productCount: 0, buyRequestCount: 0 }
            current.count += count
            current[kind === 'product' ? 'productCount' : 'buyRequestCount'] += count
            current.weightedLatitude += Number(row.latitude) * count
            current.weightedLongitude += Number(row.longitude) * count
            current.bounds.south = Math.min(current.bounds.south, Number(row.south))
            current.bounds.north = Math.max(current.bounds.north, Number(row.north))
            current.bounds.west = Math.min(current.bounds.west, Number(row.west))
            current.bounds.east = Math.max(current.bounds.east, Number(row.east))
            groups.set(key, current)
        }
        return [...groups.values()].map(({ weightedLatitude, weightedLongitude, ...group }) => ({ ...group,
            latitude: weightedLatitude / group.count, longitude: weightedLongitude / group.count })).sort((a, b) => b.count - a.count || a.id.localeCompare(b.id))
    }

    private async products(center: MapPoint, filters: MapFilterState, aggregate: true): Promise<GeoBucket[]>
    private async products(center: MapPoint, filters: MapFilterState, aggregate?: false): Promise<MapMarker[]>
    private async products(center: MapPoint, filters: MapFilterState, aggregate = false): Promise<MapMarker[] | GeoBucket[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const distancePoint = filters.exactDistance ? 'p' : 'public_point'
        const conditions = [`p.status = 'active'`, filters.nationwide || filters.includeOwnerListings ? '$3::numeric IS NOT NULL' : `${distanceSql(distancePoint)} <= $3`, 'public_point.latitude IS NOT NULL', 'public_point.longitude IS NOT NULL']
        if (aggregate && (filters.nationwide || filters.includeOwnerListings)) conditions.push('$1::numeric IS NOT NULL', '$2::numeric IS NOT NULL')
        if (filters.cityName && !filters.cityBoundary) {
            const match = settlementCondition('public_point.settlement_code', 'public_point.geo_zone', filters, parameters)
            conditions.push(filters.cityOutsideKm !== undefined ? `(${match} OR ${distanceSql('public_point')} <= $3)` : match)
        }
        conditions.push(...viewportConditions('public_point', filters.viewport, parameters))
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(categoryFilterSql('p.category_id', parameters.length)) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`public_point.geo_zone ILIKE $${parameters.length}`) }
        if (filters.region) conditions.push(regionCondition('public_point.settlement_code', 'public_point.geo_zone', filters.region, parameters))
        if (filters.geoSettlementCode) conditions.push(settlementCondition('public_point.settlement_code', 'public_point.geo_zone', { settlementCode: filters.geoSettlementCode, cityName: getSettlement(filters.geoSettlementCode)!.name }, parameters))
        if (filters.deliveryMethod) {
            const index = parameters.push(filters.deliveryMethod)
            conditions.push(`(p.delivery_options @> jsonb_build_array(jsonb_build_object('method', $${index}::text)) OR (p.delivery_options IS NULL AND p.delivery_mode = CASE $${index}::text WHEN 'SELF_PICKUP' THEN 'pickup' WHEN 'SELLER_DELIVERY' THEN 'seller_delivery' WHEN 'POSTAL_DELIVERY' THEN 'carrier' ELSE 'flexible' END))`)
        }
        const search = filters.searchIn === 'owner' ? null : smartSearchSql(listingSearchColumns('product'), filters.q, parameters, filters.searchIn === 'title')
        if (filters.searchIn === 'owner') conditions.push(...textSearchConditions(['u.username', 'u.nickname'], filters.q, parameters))
        if (search) conditions.push(search.condition)
        const publicLat = 'floor(public_point.latitude * 100 + 0.5) / 100'
        const publicLon = 'floor(public_point.longitude * 100 + 0.5) / 100'
        const select = aggregate ? `public_point.settlement_code, avg(${publicLat}) AS latitude, avg(${publicLon}) AS longitude,
            min(${publicLat}) AS south, max(${publicLat}) AS north, min(${publicLon}) AS west, max(${publicLon}) AS east, count(*) AS count` : `p.id, p.title, public_point.geo_zone, public_point.latitude, public_point.longitude, p.category_id, c.name AS category_name, c.image_index, p.price, p.currency, p.quantity, p.reserved_quantity, p.unit, p.delivery_mode, p.delivery_options,
            (p.map_location_mode IN ('pin', 'address') OR p.address_visibility = 'public' OR (p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))))) AS is_public_point,
            CASE WHEN p.address_visibility = 'public' THEN p.pickup_address WHEN p.map_location_mode = 'profile' AND u.map_location_mode = 'address' THEN u.exact_address ELSE NULL END AS public_address,
            u.id AS owner_id, u.username AS owner_username, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar_url,
            (u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%') AS is_demo,
            photo.url AS photo_url, ${distanceSql(distancePoint)} AS distance_km, ${search?.rank ?? '0'} AS relevance`
        const result = await this.queryable.query(`SELECT ${select}
            FROM products p JOIN categories c ON c.id = p.category_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id JOIN users u ON u.id = p.owner_id
            CROSS JOIN LATERAL (SELECT CASE WHEN u.email LIKE '%@rivne-demo.example.invalid' AND u.bio LIKE '%rivne-demo-v1%' THEN 100000::numeric ELSE 100::numeric END AS factor) privacy
            CROSS JOIN LATERAL (SELECT
                CASE WHEN p.map_location_mode IN ('pin', 'address') OR p.address_visibility = 'public' THEN p.latitude WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN u.public_latitude ELSE floor(p.latitude * privacy.factor + 0.5) / privacy.factor END AS latitude,
                CASE WHEN p.map_location_mode IN ('pin', 'address') OR p.address_visibility = 'public' THEN p.longitude WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN u.public_longitude ELSE floor(p.longitude * privacy.factor + 0.5) / privacy.factor END AS longitude,
                CASE WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN COALESCE(NULLIF(u.location_display, ''), p.geo_zone) ELSE p.geo_zone END AS geo_zone,
                CASE WHEN p.map_location_mode = 'profile' AND u.map_location_mode <> 'approximate' AND p.settlement_code IS NOT DISTINCT FROM u.settlement_code AND (NULLIF(p.geo_zone, '') IS NULL OR (NULLIF(u.location_display, '') IS NOT NULL AND lower(p.geo_zone) = lower(u.location_display))) THEN u.settlement_code ELSE p.settlement_code END AS settlement_code
            ) public_point
            ${aggregate ? '' : 'LEFT JOIN LATERAL (SELECT url FROM product_photos WHERE product_id = p.id ORDER BY sort_order, id LIMIT 1) photo ON true'}
            WHERE ${conditions.join(' AND ')} ${aggregate ? `GROUP BY public_point.settlement_code, CASE WHEN public_point.settlement_code IS NULL THEN floor(${publicLat} * 2) END, CASE WHEN public_point.settlement_code IS NULL THEN floor(${publicLon} * 2) END` : 'ORDER BY p.id'}`, parameters)
        return aggregate ? result.rows as GeoBucket[] : result.rows.map((row) => this.marker(row, 'product'))
    }

    private async buyRequests(center: MapPoint, filters: MapFilterState, aggregate: true): Promise<GeoBucket[]>
    private async buyRequests(center: MapPoint, filters: MapFilterState, aggregate?: false): Promise<MapMarker[]>
    private async buyRequests(center: MapPoint, filters: MapFilterState, aggregate = false): Promise<MapMarker[] | GeoBucket[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const distancePoint = filters.exactDistance ? 'r' : 'public_point'
        const conditions = [`r.status IN ('open', 'partially_selected', 'partially_completed', 'partially_fulfilled')`, filters.nationwide || filters.includeOwnerListings ? '$3::numeric IS NOT NULL' : `${distanceSql(distancePoint)} <= $3`, 'public_point.latitude IS NOT NULL', 'public_point.longitude IS NOT NULL']
        if (aggregate && (filters.nationwide || filters.includeOwnerListings)) conditions.push('$1::numeric IS NOT NULL', '$2::numeric IS NOT NULL')
        if (filters.buyRequestIds) { parameters.push(filters.buyRequestIds); conditions.push(`r.id = ANY($${parameters.length}::uuid[])`) }
        if (filters.cityName && !filters.cityBoundary) {
            const match = settlementCondition('public_point.settlement_code', 'public_point.geo_area', filters, parameters)
            conditions.push(filters.cityOutsideKm !== undefined ? `(${match} OR ${distanceSql('public_point')} <= $3)` : match)
        }
        conditions.push(...viewportConditions('public_point', filters.viewport, parameters))
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(categoryFilterSql('r.category_id', parameters.length)) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`public_point.geo_area ILIKE $${parameters.length}`) }
        if (filters.region) conditions.push(regionCondition('public_point.settlement_code', 'public_point.geo_area', filters.region, parameters))
        if (filters.geoSettlementCode) conditions.push(settlementCondition('public_point.settlement_code', 'public_point.geo_area', { settlementCode: filters.geoSettlementCode, cityName: getSettlement(filters.geoSettlementCode)!.name }, parameters))
        if (filters.deliveryMethod) {
            const index = parameters.push(filters.deliveryMethod)
            conditions.push(`(r.delivery_options @> jsonb_build_array(jsonb_build_object('method', $${index}::text)) OR (r.delivery_options IS NULL AND r.receipt_method = $${index}::text))`)
        }
        const search = filters.searchIn === 'owner' ? null : smartSearchSql(listingSearchColumns('buyRequest'), filters.q, parameters, filters.searchIn === 'title')
        if (filters.searchIn === 'owner') conditions.push(...textSearchConditions(['u.username', 'u.nickname'], filters.q, parameters))
        if (search) conditions.push(search.condition)
        const publicLat = 'floor(public_point.latitude * 100 + 0.5) / 100'
        const publicLon = 'floor(public_point.longitude * 100 + 0.5) / 100'
        const select = aggregate ? `public_point.settlement_code, avg(${publicLat}) AS latitude, avg(${publicLon}) AS longitude,
            min(${publicLat}) AS south, max(${publicLat}) AS north, min(${publicLon}) AS west, max(${publicLon}) AS east, count(*) AS count` : `r.id, r.title, r.requested_quantity AS quantity, r.unit, r.delivery_options, public_point.geo_area, public_point.latitude, public_point.longitude, r.category_id, c.name AS category_name, c.image_index, photo.url AS photo_url,
            u.id AS owner_id, u.username AS owner_username, u.nickname AS owner_nickname, u.avatar_url AS owner_avatar_url,
            (r.address_visibility = 'public') AS is_public_point,
            CASE WHEN r.address_visibility = 'public' THEN r.delivery_address ELSE NULL END AS public_address,
            ${distanceSql(distancePoint)} AS distance_km, ${search?.rank ?? '0'} AS relevance`
        const result = await this.queryable.query(`SELECT ${select} FROM buy_requests r JOIN categories c ON c.id = r.category_id LEFT JOIN categories parent_c ON parent_c.id = c.parent_id JOIN users u ON u.id = r.buyer_id
            ${requestPublicLocationSql} ${aggregate ? '' : 'LEFT JOIN LATERAL (SELECT url FROM buy_request_photos WHERE buy_request_id = r.id ORDER BY sort_order, id LIMIT 1) photo ON true'} WHERE ${conditions.join(' AND ')} ${aggregate ? `GROUP BY public_point.settlement_code, CASE WHEN public_point.settlement_code IS NULL THEN floor(${publicLat} * 2) END, CASE WHEN public_point.settlement_code IS NULL THEN floor(${publicLon} * 2) END` : 'ORDER BY r.id'}`, parameters)
        return aggregate ? result.rows as GeoBucket[] : result.rows.map((row) => this.marker(row, 'buyRequest'))
    }

    private marker(row: any, kind: MapMarker['kind']): MapMarker {
        // Detailed demo positions are safe; real users retain the existing privacy rounding.
        const coordinates = { latitude: Number(row.latitude), longitude: Number(row.longitude) }
        const point = row.is_public_point ? coordinates : approximatePoint(coordinates, row.is_demo ? 5 : 2)
        const distance = Number(row.distance_km)
        const distanceBand = distance <= 1 ? 'до 1 км' : distance <= 3 ? '1–3 км' : distance <= 5 ? '3–5 км' : distance <= 10 ? '5–10 км' : distance <= 20 ? '10–20 км' : 'понад 20 км'
        return { id: row.id, kind, title: row.title, geoZone: row.geo_zone ?? row.geo_area, category: { id: row.category_id, name: row.category_name, imageIndex: row.image_index }, ...(row.owner_id ? { owner: { id: row.owner_id, username: row.owner_username, nickname: row.owner_nickname ?? null, avatarUrl: row.owner_avatar_url ?? null } } : {}), ...(row.public_address ? { publicAddress: row.public_address } : {}), ...(kind === 'product' ? { photoUrl: row.photo_url ?? null, price: { amount: Number(row.price), currency: row.currency }, quantity: Number(row.quantity) - Number(row.reserved_quantity ?? 0), unit: row.unit, deliveryMode: row.delivery_mode } : { photoUrl: row.photo_url ?? null, quantity: Number(row.quantity), unit: row.unit }), deliveryOptions: row.delivery_options ?? null, ...point, approximate: !row.is_public_point, distanceBand, relevance: Number(row.relevance ?? 0) }
    }
}
