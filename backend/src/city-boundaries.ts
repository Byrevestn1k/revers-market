export type Point = { latitude: number; longitude: number }
export type CityBoundary = { rings: Point[][]; maxDistanceKm: number }

const cache = new Map<string, { expiresAt: number; value: CityBoundary | null }>()
const DAY = 24 * 60 * 60 * 1000
const distanceKm = (a: Point, b: Point) => {
    const radians = Math.PI / 180
    const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2
    return 12742 * Math.asin(Math.min(1, Math.sqrt(h)))
}
const ringsFromGeoJson = (geometry: any): Point[][] => {
    const polygons = geometry?.type === 'Polygon' ? [geometry.coordinates] : geometry?.type === 'MultiPolygon' ? geometry.coordinates : []
    return polygons.flatMap((polygon: any[]) => polygon.slice(0, 1)).map((ring: any[]) => ring.map(([longitude, latitude]: [unknown, unknown]) => ({ latitude: Number(latitude), longitude: Number(longitude) })).filter((point: Point) => Number.isFinite(point.latitude) && Number.isFinite(point.longitude))).filter((ring: Point[]) => ring.length >= 3)
}

export async function cityBoundary(name: string, center: Point): Promise<CityBoundary | null> {
    const key = name.trim().toLocaleLowerCase('uk-UA')
    const known = cache.get(key)
    if (known && known.expiresAt > Date.now()) return known.value
    let value: CityBoundary | null = null
    try {
        const params = new URLSearchParams({ city: name, country: 'Ukraine', format: 'jsonv2', polygon_geojson: '1', limit: '5', addressdetails: '1' })
        const response = await fetch('https://nominatim.openstreetmap.org/search?' + params, { headers: { 'User-Agent': process.env.OSM_USER_AGENT || 'NavpakyMarketplace/1.0 (city-boundary lookup)' }, signal: AbortSignal.timeout(8000) })
        const results = response.ok ? await response.json() : []
        const rings = Array.isArray(results) ? results.flatMap(item => ringsFromGeoJson(item.geojson)) : []
        if (rings.length) value = { rings, maxDistanceKm: Math.max(...rings.flat().map(point => distanceKm(center, point))) }
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
    const scaleX = 111.32 * Math.cos(point.latitude * Math.PI / 180), scaleY = 110.57
    const x = (point.longitude - start.longitude) * scaleX, y = (point.latitude - start.latitude) * scaleY
    const dx = (end.longitude - start.longitude) * scaleX, dy = (end.latitude - start.latitude) * scaleY
    const factor = Math.max(0, Math.min(1, (x * dx + y * dy) / (dx * dx + dy * dy || 1)))
    return Math.hypot(x - factor * dx, y - factor * dy)
}
export function withinCityOrDistance(point: Point, boundary: CityBoundary, extraKm: number) {
    if (boundary.rings.some(ring => inside(point, ring))) return true
    return boundary.rings.some(ring => ring.some((start, index) => distanceToSegment(point, start, ring[(index + 1) % ring.length]) <= extraKm))
}
