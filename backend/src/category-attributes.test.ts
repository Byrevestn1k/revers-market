import { describe, expect, it } from 'vitest'
import { validateAttributes } from './category-attributes.js'

const definitions = [
    { code: 'brand', valueType: 'text', required: false },
    { code: 'year', valueType: 'number', minValue: 1900, maxValue: 2100, required: false },
    { code: 'distance', valueType: 'number_unit', minValue: 0, maxValue: 1000, required: false },
    { code: 'condition', valueType: 'single', options: ['Новий', 'Вживаний'], required: false },
    { code: 'features', valueType: 'multiple', options: ['NFC', '5G'], required: false },
    { code: 'unlocked', valueType: 'boolean', required: false },
]
const db = { query: async () => ({ rows: definitions }) } as any

describe('category attribute validation', () => {
    it('accepts supported values and legacy empty attributes', async () => {
        expect(await validateAttributes('category', {}, db)).toBe(true)
        expect(await validateAttributes('category', { brand: 'Samsung', year: 2023, distance: 12.5, condition: 'Новий', features: ['NFC'], unlocked: false }, db)).toBe(true)
    })
    it.each([null, [], { foreign: 'value' }, { brand: 7 }, { year: 1800 }, { distance: -1 }, { condition: 'bad' }, { features: ['NFC', 'NFC'] }, { features: ['unknown'] }, { unlocked: 'true' }])('rejects invalid attributes: %j', async value => {
        expect(await validateAttributes('category', value, db)).toBe(false)
    })
})
