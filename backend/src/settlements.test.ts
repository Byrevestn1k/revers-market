import { describe, expect, it } from 'vitest'
import { getSettlement, searchSettlements, validateSettlement } from './settlements.js'

describe('official settlement directory', () => {
    it('returns all namesakes, ordered cities then towns then villages', () => {
        const matches = searchSettlements('Мирне').settlements.filter(item => item.name === 'Мирне')
        expect(matches.length).toBeGreaterThan(40)
        const ranks = matches.map(item => ({ city: 0, town: 1, village: 2 })[item.type])
        expect(ranks).toEqual([...ranks].sort())
        expect(new Set(matches.map(item => item.code)).size).toBe(matches.length)
        expect(matches.every(item => item.district && item.region)).toBe(true)
    })
    it('keeps a town distinct from cities and villages and supports prefixes', () => {
        const city = searchSettlements('Рівне').settlements.find(item => item.name === 'Рівне' && item.type === 'city')!
        expect(city.region).toBe('Рівненська область')
        expect(getSettlement(city.code)).toEqual(city)
        expect(searchSettlements('с. Бармаки').settlements[0].type).toBe('village')
        expect(searchSettlements('Клевань').settlements[0].type).toBe('town')
        expect(searchSettlements('Р').settlements).toEqual([])
    })
    it('rejects forged identities and mismatched names, permits legacy addresses', () => {
        const item = searchSettlements('Бармаки').settlements[0]
        expect(validateSettlement({ settlementCode: item.code, geoZone: item.name }, 'geoZone')).toEqual([])
        expect(validateSettlement({ settlementCode: item.code, geoZone: 'Рівне' }, 'geoZone')).toEqual(['settlementCode'])
        expect(validateSettlement({ settlementCode: 'invalid' }, 'geoZone')).toEqual(['settlementCode'])
        expect(validateSettlement({ geoZone: 'Рівне' }, 'geoZone')).toEqual([])
    })
})
