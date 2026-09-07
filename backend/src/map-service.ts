import type { PoolClient } from 'pg'
import { pool } from './db/client.js'

export type MapPoint = { latitude: number; longitude: number }
export type MapFilterState = { categoryId?: string; geoZone?: string; radiusKm: number; showProducts: boolean; showBuyRequests: boolean; mapCenter?: MapPoint }
export type MapMarker = MapPoint & {
    id: string
    kind: 'product' | 'buyRequest'
    title: string
    geoZone: string
    category: { id: string; name: string }
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
})

const distanceSql = (table: string) =>
    `6371 * acos(LEAST(1, GREATEST(-1, cos(radians($1)) * cos(radians(${table}.latitude)) * cos(radians(${table}.longitude) - radians($2)) + sin(radians($1)) * sin(radians(${table}.latitude)))))`

type Queryable = Pick<PoolClient, 'query'>

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
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(`p.category_id = $${parameters.length}`) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`p.geo_zone ILIKE $${parameters.length}`) }
        const result = await this.queryable.query(`SELECT p.id, p.title, p.geo_zone, p.latitude, p.longitude, p.category_id, c.name AS category_name, ${distanceSql('p')} AS distance_km FROM products p JOIN categories c ON c.id = p.category_id WHERE ${conditions.join(' AND ')}`, parameters)
        return result.rows.map((row) => this.marker(row, 'product'))
    }

    private async buyRequests(center: MapPoint, filters: MapFilterState): Promise<MapMarker[]> {
        const parameters: unknown[] = [center.latitude, center.longitude, filters.radiusKm]
        const conditions = [`r.status IN ('open', 'partially_fulfilled')`, `${distanceSql('r')} <= $3`, 'r.latitude IS NOT NULL', 'r.longitude IS NOT NULL']
        if (filters.categoryId) { parameters.push(filters.categoryId); conditions.push(`r.category_id = $${parameters.length}`) }
        if (filters.geoZone) { parameters.push(`%${filters.geoZone}%`); conditions.push(`r.geo_area ILIKE $${parameters.length}`) }
        const result = await this.queryable.query(`SELECT r.id, r.title, r.geo_area, r.latitude, r.longitude, r.category_id, c.name AS category_name, ${distanceSql('r')} AS distance_km FROM buy_requests r JOIN categories c ON c.id = r.category_id WHERE ${conditions.join(' AND ')}`, parameters)
        return result.rows.map((row) => this.marker(row, 'buyRequest'))
    }

    private marker(row: any, kind: MapMarker['kind']): MapMarker {
        const point = approximatePoint({ latitude: Number(row.latitude), longitude: Number(row.longitude) })
        return { id: row.id, kind, title: row.title, geoZone: row.geo_zone ?? row.geo_area, category: { id: row.category_id, name: row.category_name }, ...point, approximate: true, distanceKm: Number(Number(row.distance_km).toFixed(2)) }
    }
}