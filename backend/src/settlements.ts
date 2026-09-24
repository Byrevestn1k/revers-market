import { readFileSync } from 'node:fs'

export type Settlement = { code: string; name: string; type: 'city' | 'town' | 'village'; district: string; region: string; community: string }
const data = JSON.parse(readFileSync(new URL('../data/settlements.json', import.meta.url), 'utf8')) as { version: string; settlements: Settlement[] }
const byCode = new Map(data.settlements.map(item => [item.code, item]))
export const normalizeSettlementName = (value: string) => value.trim().toLocaleLowerCase('uk-UA').replace(/^(?:місто|селище|село|смт\.?|м\.|с\.|с-ще)\s+/u, '').replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ')
const rank = { city: 0, town: 1, village: 2 }
const ordered = [...data.settlements].sort((a, b) => rank[a.type] - rank[b.type] || a.name.localeCompare(b.name, 'uk') || a.region.localeCompare(b.region, 'uk') || a.district.localeCompare(b.district, 'uk') || a.code.localeCompare(b.code))
const searchable = ordered.map(item => ({ item, name: normalizeSettlementName(item.name) }))
const regions = [...new Set(ordered.map(item => item.region))].sort((a, b) => a.localeCompare(b, 'uk'))
export const getSettlement = (code: unknown): Settlement | null => typeof code === 'string' ? byCode.get(code) ?? null : null
export function listSettlementRegions() { return { version: data.version, regions } }
export function listSettlementsInRegion(region: string, offset = 0, limit = 100) {
    const settlements = ordered.filter(item => item.region === region).sort((a, b) => a.name.localeCompare(b.name, 'uk') || a.district.localeCompare(b.district, 'uk') || a.code.localeCompare(b.code))
    return { version: data.version, settlements: settlements.slice(offset, offset + limit), total: settlements.length }
}
export function searchSettlements(query: string) {
    const term = normalizeSettlementName(query)
    // Do not truncate: even common names must include every matching village.
    return { version: data.version, settlements: term.length < 2 ? [] : searchable.filter(entry => entry.name.includes(term)).map(entry => entry.item) }
}
export function validateSettlement(input: Record<string, unknown>, nameField: string): string[] {
    if (input.settlementCode == null) return [] // Existing clients/records remain compatible.
    const item = getSettlement(input.settlementCode)
    return !item || (input[nameField] !== undefined && (typeof input[nameField] !== 'string' || normalizeSettlementName(input[nameField] as string) !== normalizeSettlementName(item.name))) ? ['settlementCode'] : []
}
