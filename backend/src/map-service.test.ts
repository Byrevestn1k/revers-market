import { describe, expect, it } from 'vitest'
import { adaptiveRadius, approximatePoint, clampRadius, syncMapFilters, type MapProviderAdapter } from './map-service.js'

describe('MapService primitives', () => {
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