import { describe, expect, it } from 'vitest'
import { MapService, adaptiveRadius, approximatePoint, clampRadius, syncMapFilters, viewportConditions, type MapProviderAdapter } from './map-service.js'

describe('MapService primitives', () => {
    it('keeps real addresses private while retaining precise demo locations and previews', async () => {
        const row = { id: 'product', title: 'Товар', latitude: 50.625951, longitude: 26.270642, category_id: 'category', category_name: 'Категорія', image_index: 7, price: '100', currency: 'UAH', photo_url: 'https://example.com/product.jpg', distance_km: 1 }
        const service = new MapService({ query: async () => ({ rows: [{ ...row, is_demo: false }, { ...row, id: 'demo', is_demo: true }] }) } as any)
        const markers = await service.findMarkers({ latitude: 50.62, longitude: 26.25 }, { showBuyRequests: false })
        expect(markers[0].latitude).toBe(50.63)
        expect(markers[0].longitude).toBe(26.27)
        expect(markers[1].latitude).toBe(50.62595)
        expect(markers[1].longitude).toBe(26.27064)
        expect(markers[1].photoUrl).toBe(row.photo_url)
        expect(markers[1].category.imageIndex).toBe(7)
        expect(markers[1].price).toEqual({ amount: 100, currency: 'UAH' })
    })
    it('restricts markers to the viewport using bound parameters', () => {
        const values: unknown[] = [50, 26, 25]
        expect(viewportConditions('p', { south: 50.6, north: 50.7, west: 26.2, east: 26.3 }, values)).toEqual(['p.latitude BETWEEN $4 AND $5', 'p.longitude BETWEEN $6 AND $7'])
        expect(values).toEqual([50, 26, 25, 50.6, 50.7, 26.2, 26.3])
        expect(viewportConditions('r', { south: -10, north: 10, west: 170, east: -170 }, [])).toEqual(['r.latitude BETWEEN $1 AND $2', '(r.longitude >= $3 OR r.longitude <= $4)'])
    })
    it('clamps configurable radius and adapts it to zoom', () => {
        expect(clampRadius(-3)).toBe(1)
        expect(clampRadius(999)).toBe(200)
        expect(adaptiveRadius(100, 14)).toBe(10)
        expect(adaptiveRadius(10, 7)).toBe(50)
    })

    it('rounds coordinates before public display', () => {
        expect(approximatePoint({ latitude: 50.450612, longitude: 30.523901 })).toEqual({ latitude: 50.45, longitude: 30.52 })
    })

    it('keeps filter and map state synchronized', () => {
        expect(syncMapFilters({ geoZone: '  Kyiv  ', showProducts: false })).toEqual({ geoZone: 'Kyiv', radiusKm: 25, showProducts: false, showBuyRequests: true })
    })

    it('allows replacing the map provider through the adapter contract', () => {
        const adapter: MapProviderAdapter = {
            toProviderPoint: (point) => ({ lat: point.latitude, lng: point.longitude }),
            fromProviderPoint: (point) => {
                if (!point || typeof point !== 'object' || !('lat' in point) || !('lng' in point)) return null
                return { latitude: Number(point.lat), longitude: Number(point.lng) }
            },
        }
        const point = { latitude: 50.45, longitude: 30.52 }
        expect(adapter.fromProviderPoint(adapter.toProviderPoint(point))).toEqual(point)
    })
})
