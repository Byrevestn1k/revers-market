import type { Settlement } from './settlements.js'
export type Point = { latitude: number; longitude: number }
export type CityBoundary = { rings: Point[][]; polygons?: Point[][][]; maxDistanceKm: number; source?: { provider: 'OSM'; osmType: string; osmId: number; settlementCode: string } }

const cache = new Map<string, { expiresAt: number; value: CityBoundary | null }>()
const DAY = 24 * 60 * 60 * 1000
export const distanceKm = (a: Point, b: Point) => {
    const radians = Math.PI / 180
    const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}
const boundaryFromGeoJson = (geometry: any): CityBoundary | null => {
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
    const points: Point[][][] = polygons.map((polygon: number[][][]) => polygon.map(ring => ring.map(([longitude, latitude]) => ({ latitude, longitude }))))
    if (!points.length || !points.every(polygon => polygon.length && polygon.every(ring => ring.length >= 4 && ring[0].latitude === ring[ring.length - 1].latitude && ring[0].longitude === ring[ring.length - 1].longitude && ring.every(point => Number.isFinite(point.latitude) && Math.abs(point.latitude) <= 90 && Number.isFinite(point.longitude) && Math.abs(point.longitude) <= 180)))) return null
    return { polygons: points, rings: points.map(polygon => polygon[0]), maxDistanceKm: 0 }
}
const providerCache = new Map<string, { expiresAt: number; results: any[] }>()
// Search and subscriptions obtain the same provider geometry and identity metadata.
const cityBoundaryCandidates = async (name: string, settlement?: Settlement | null): Promise<any[]> => {
    const key = settlement?.code ?? name.trim().toLocaleLowerCase('uk-UA')
    const known = providerCache.get(key)
    if (known && known.expiresAt > Date.now()) return known.results
    const specialCity = settlement?.type === 'city' && !settlement.district && placeName(settlement.region) === placeName(settlement.name)
    const params = new URLSearchParams({ city: name, country: 'Ukraine', format: 'jsonv2', polygon_geojson: '1', limit: '10', addressdetails: '1', extratags: '1', 'accept-language': 'uk', countrycodes: 'ua' })
    if (settlement && !specialCity) params.set('state', settlement.region)
    const response = await fetch('https://nominatim.openstreetmap.org/search?' + params, { headers: { 'User-Agent': process.env.OSM_USER_AGENT || 'NavpakyMarketplace/1.0 (city-boundary lookup)' }, signal: AbortSignal.timeout(8000) })
    const payload = response.ok ? await response.json() : []
    const results = Array.isArray(payload) ? payload : []
    providerCache.set(key, { results, expiresAt: Date.now() + (results.length ? DAY : 60_000) })
    return results
}

export async function cityBoundary(name: string, center: Point, settlement?: Settlement | null): Promise<CityBoundary | null> {
    const key = `${settlement?.code ?? name.trim().toLocaleLowerCase('uk-UA')}:${center.latitude.toFixed(2)}:${center.longitude.toFixed(2)}`
    const known = cache.get(key)
    if (known && known.expiresAt > Date.now()) return known.value
    let value: CityBoundary | null = null
    try {
        const results = await cityBoundaryCandidates(name, settlement)
        // Never union boundaries of namesakes in different regions.
        const candidates = Array.isArray(results) ? results.filter(item => Number.isFinite(Number(item.lat)) && Number.isFinite(Number(item.lon)) && distanceKm(center, { latitude: Number(item.lat), longitude: Number(item.lon) }) < 25).sort((a, b) => distanceKm(center, { latitude: Number(a.lat), longitude: Number(a.lon) }) - distanceKm(center, { latitude: Number(b.lat), longitude: Number(b.lon) })) : []
        const boundary = candidates.length ? boundaryFromGeoJson(candidates[0].geojson) : null
        if (boundary) value = { ...boundary, maxDistanceKm: Math.max(...boundary.rings.flat().map(point => distanceKm(center, point))) }
    } catch { /* The existing city-only search remains available when OSM is unavailable. */ }
    cache.set(key, { value, expiresAt: Date.now() + DAY })
    return value
}

const inside = (point: Point, ring: Point[]) => {
    let result = false
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const a = ring[i], b = ring[j]
        if ((a.latitude > point.latitude) !== (b.latitude > point.latitude) && point.longitude < (b.longitude - a.longitude) * (point.latitude - a.latitude) / (b.latitude - a.latitude) + a.longitude) result = !result
    }
    return result
}
const distanceToSegment = (point: Point, start: Point, end: Point) => {
    const radians = Math.PI / 180, earthRadiusKm = 6371
    const bearing = (a: Point, b: Point) => Math.atan2(
        Math.sin((b.longitude - a.longitude) * radians) * Math.cos(b.latitude * radians),
        Math.cos(a.latitude * radians) * Math.sin(b.latitude * radians) - Math.sin(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.cos((b.longitude - a.longitude) * radians),
    )
    const segment = distanceKm(start, end) / earthRadiusKm
    if (!segment) return distanceKm(point, start)
    const fromStart = distanceKm(start, point) / earthRadiusKm
    const angle = bearing(start, point) - bearing(start, end)
    const along = Math.atan2(Math.sin(fromStart) * Math.cos(angle), Math.cos(fromStart))
    if (along < 0 || along > segment) return Math.min(distanceKm(point, start), distanceKm(point, end))
    return Math.abs(Math.asin(Math.max(-1, Math.min(1, Math.sin(fromStart) * Math.sin(angle))))) * earthRadiusKm
}
export function withinCityOrDistance(point: Point, boundary: CityBoundary, extraKm: number) {
    const polygons = boundary.polygons ?? boundary.rings.map(ring => [ring])
    if (polygons.some(([outer, ...holes]) => inside(point, outer) && !holes.some(hole => inside(point, hole)))) return true
    return polygons.flat().some(ring => ring.some((start, index) => distanceToSegment(point, start, ring[(index + 1) % ring.length]) <= extraKm + 1e-9))
}

const administrativeCache = new Map<string, { expiresAt: number; value: CityBoundary | null }>()
const placeName = (name: string) => name.toLocaleLowerCase('uk-UA').trim().replace(/^(місто|селище|село|м\.)\s+/u, '').replace(/\s+(область|обл\.|район|р-н)$/u, '').trim()

// Accept an administrative polygon or a place polygon tied to the exact directory code.
// There is no center-radius fallback for subscriptions.
export async function settlementAdministrativeBoundary(settlement: Settlement): Promise<CityBoundary | null> {
    const cached = administrativeCache.get(settlement.code)
    if (cached && cached.expiresAt > Date.now()) return cached.value
    let value: CityBoundary | null = null
    try {
        const specialCity = settlement.type === 'city' && !settlement.district && placeName(settlement.region) === placeName(settlement.name)
        const results = await cityBoundaryCandidates(settlement.name, settlement)
        const candidates = Array.isArray(results) ? results.filter(item => {
            const address = item.address ?? {}
            const sameName = placeName(item.name ?? '') === placeName(settlement.name)
            const sameRegion = placeName(address.state ?? '') === placeName(settlement.region) || specialCity
            const sameDistrict = settlement.type === 'city' || !settlement.district || placeName(address.county ?? address.state_district ?? address.district ?? '') === placeName(settlement.district)
            const administrative = (item.class ?? item.category) === 'boundary' && item.type === 'administrative'
                && (['8', '9', '10'].includes(String(item.extratags?.admin_level)) || specialCity && String(item.extratags?.admin_level) === '4')
            const identifiedPlace = (item.class ?? item.category) === 'place' && item.type === settlement.type
                && ['relation', 'way'].includes(item.osm_type) && Number.isSafeInteger(item.osm_id) && item.osm_id > 0 && item.extratags?.katotth === settlement.code
            return (administrative || identifiedPlace) && address.country_code === 'ua'
                && sameName && sameRegion && sameDistrict && ['Polygon', 'MultiPolygon'].includes(item.geojson?.type)
        }) : []
        if (candidates.length === 1) {
            const item = candidates[0]
            value = boundaryFromGeoJson(item.geojson)
            if (value && ['relation', 'way'].includes(item.osm_type) && Number.isSafeInteger(item.osm_id)) value.source = { provider: 'OSM', osmType: item.osm_type, osmId: item.osm_id, settlementCode: settlement.code }
        }
    } catch { /* Missing or ambiguous public boundaries are reported by subscription validation. */ }
    if (!value) providerCache.delete(settlement.code) // A failed identity/geometry check must be retryable after 60s.
    administrativeCache.set(settlement.code, { value, expiresAt: Date.now() + (value ? DAY : 60_000) })
    return value
}
