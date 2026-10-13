import { describe, expect, it } from 'vitest'
import { mapFocusPlan } from './map-interactions'

describe('mobile map selection', () => {
    const point = { latitude: 50.45, longitude: 30.52 }

    it('centers a marker without scrolling away from the map', () => {
        expect(mapFocusPlan(point, 12, 'marker')).toEqual({ center: [50.45, 30.52], zoom: 12, scrollToMap: false })
    })

    it('centers and expands a cluster', () => {
        expect(mapFocusPlan(point, 12, 'cluster')).toEqual({ center: [50.45, 30.52], zoom: 14, scrollToMap: false })
        expect(mapFocusPlan(point, 18, 'cluster').zoom).toBe(19)
    })

    it('returns from a list card to a visible individual marker', () => {
        expect(mapFocusPlan(point, 10, 'list')).toEqual({ center: [50.45, 30.52], zoom: 14, scrollToMap: true })
    })
})
