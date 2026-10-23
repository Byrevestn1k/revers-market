import { describe, expect, it } from 'vitest'
import { buildMapNodes, geoLevelForViewport } from './map-clusters'
import type { SellerProductPoint } from './map-sellers'

const point = (id: string, kind: SellerProductPoint['kind'], latitude = 50.45, longitude = 30.52): SellerProductPoint => ({
    id, kind, title: id, latitude, longitude, distanceBand: 'поруч', geoZone: 'Київ',
    category: { id: 'category', name: 'Категорія' }, owner: { id: 'owner-' + id, username: 'owner-' + id },
})
const options = { zoom: 12, width: 390, height: 480, filtered: true, mode: 'adaptive' as const }
const project = (item: SellerProductPoint) => ({ x: 120 + item.longitude, y: 160 + item.latitude })

describe('map clusters', () => {
    it('uses visible territory and zoom to switch administrative levels off near a city', () => {
        expect(geoLevelForViewport(6, { south: 44, north: 52 }, true)).toBe('region')
        expect(geoLevelForViewport(9, { south: 50, north: 51 }, true)).toBe('district')
        expect(geoLevelForViewport(12, { south: 50.5, north: 50.7 }, true)).toBeNull()
        expect(geoLevelForViewport(6, { south: 50.5, north: 50.6 }, true)).toBeNull()
        expect(geoLevelForViewport(6, { south: 44, north: 52 }, false)).toBeNull()
    })
    it('renders one filtered product or request as an individual marker at count zoom', () => {
        expect(buildMapNodes([point('product', 'product')], project, options).map(({ type, items }) => [type, items.length])).toEqual([['product', 1]])
        expect(buildMapNodes([point('request', 'buyRequest')], project, options).map(({ type, items }) => [type, items.length])).toEqual([['request', 1]])
    })

    it('keeps nearby multiple results grouped at count zoom', () => {
        const nodes = buildMapNodes([point('one', 'product'), point('two', 'product', 50.4501, 30.5201)], project, options)
        expect(nodes).toHaveLength(1)
        expect(nodes[0]).toMatchObject({ type: 'cluster' })
        expect(nodes[0].items).toHaveLength(2)
    })

    it('retains same-coordinate results in one cluster', () => {
        const nodes = buildMapNodes([point('one', 'buyRequest'), point('two', 'buyRequest')], project, options)
        expect(nodes[0]).toMatchObject({ type: 'cluster' })
        expect(nodes[0].items).toHaveLength(2)
    })
})
