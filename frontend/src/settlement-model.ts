import type { Coordinates } from './address-model'

export type Settlement = { code: string; name: string; type: 'city' | 'town' | 'village'; district: string; region: string; community: string }
export type SelectedSettlement = Settlement & { coordinates?: Coordinates | null; hereId?: string; hereDistrict?: string }
export type HereItem = { id: string; title: string; resultType?: string; localityType?: string; address?: { city?: string; district?: string; subdistrict?: string; county?: string; state?: string; countryCode?: string; street?: string; houseNumber?: string }; position?: { lat: number; lng: number } }
export const settlementType = (item: Settlement) => ({ city: 'місто', town: 'селище', village: 'село' })[item.type]
export const settlementLabel = (item: Settlement) => [settlementType(item), item.name, item.district || 'без району', item.region].join(', ')
export const normalizePlace = (name: string) => name.toLocaleLowerCase('uk-UA').trim().replace(/^(?:місто|селище|село|смт\.?|м\.|с\.|с-ще)\s+/u, '').replace(/[’ʼ`]/g, "'").replace(/\s+/g, ' ')
export function splitHouseNumber(value: string): { number: string; letter: string } {
    const match = value.trim().match(/^(\d+(?:[/-]\d+)?)\s*[-–—]?\s*([a-zа-яіїєґ])$/iu)
    return match ? { number: match[1], letter: match[2].toLocaleUpperCase('uk-UA') } : { number: value.trim(), letter: '' }
}
export function joinHouseNumber(number: string, letter = ''): string {
    const parts = splitHouseNumber(number)
    return parts.number ? parts.number + (letter.trim() || parts.letter).toLocaleUpperCase('uk-UA') : ''
}
export const matchesHouseNumber = (actual: string | undefined, entered: string) => Boolean(actual && entered.trim()) && joinHouseNumber(actual ?? '') === joinHouseNumber(entered)
const area = (name = '') => normalizePlace(name).replace(/\s*(область|обл\.?|район|р-н|територіальна громада|громада)$/u, '').trim()
export function matchesStreet(actual: string | undefined, entered: string): boolean {
    const tokens = (text: string) => normalizePlace(text).replace(/(?:^|\s)(?:вул\.?|вулиця)(?=\s|$)/gu, ' ').replace(/[.,]/g, ' ').split(/\s+/).filter(Boolean)
    const wanted = tokens(entered), found = tokens(actual ?? '')
    return wanted.length > 0 && wanted.every(token => found.includes(token))
}

// HERE can put a Ukrainian village in district and its raion in city.
// A HERE localityType of city is NOT a legal Ukrainian settlement type.
export function matchesSettlement(item: HereItem, settlement: SelectedSettlement, allowLegacyDistrict = false): boolean {
    const address = item.address
    if (!address || (address.countryCode && address.countryCode !== 'UKR')) return false
    const name = normalizePlace(settlement.name)
    const localName = address.district || address.city || ''
    if (normalizePlace(localName) !== name && normalizePlace(address.city || '') !== name) return false
    const region = area(settlement.region)
    const regionMatches = [address.state, address.county].some(value => area(value) === region)
    // Cities with special status are themselves a region in KATOTTG.
    if (!regionMatches && !(settlement.district === '' && normalizePlace(address.city || '') === region)) return false
    if (allowLegacyDistrict) return true // Caller has proved the name unique in this region.
    if (!settlement.district) return true
    const district = area(settlement.district)
    return [address.county, address.city].some(value => area(value) === district)
        || Boolean(settlement.hereDistrict && [address.county, address.city].some(value => area(value) === area(settlement.hereDistrict)))
        || (settlement.type === 'city' && normalizePlace(address.city || '') === name && area(address.county) === region)
}

export async function hereRequest(endpoint: 'geocode' | 'autocomplete' | 'lookup' | 'revgeocode', parameters: Record<string, string>, signal?: AbortSignal): Promise<HereItem[]> {
    const apiKey = import.meta.env.VITE_HERE_API_KEY
    if (!apiKey) throw new Error('Пошук адрес HERE не налаштований.')
    const params = new URLSearchParams({ ...parameters, lang: 'uk-UA', apiKey })
    const timeout = AbortSignal.timeout(12000)
    const response = await fetch(`https://${endpoint}.search.hereapi.com/v1/${endpoint}?${params}`, { signal: signal ? AbortSignal.any([signal, timeout]) : timeout })
    if (!response.ok) throw new Error('HERE тимчасово недоступний. Спробуйте ще раз.')
    const result = await response.json()
    return endpoint === 'lookup' ? [result] : result.items ?? []
}

export async function searchStreets(settlement: SelectedSettlement, street: string, signal?: AbortSignal): Promise<HereItem[]> {
    const prefix = street.trim().replace(/^(?:вулиця|вул\.?)(?:\s+|$)/iu, '').trim()
    if (!prefix) return []
    // HERE completes the entered prefix reliably when it is the complete query.
    // `at` keeps this common query inside the selected settlement.
    const parameters: Record<string, string> = { q: settlement.coordinates ? prefix : `${settlement.name} ${prefix}`, in: 'countryCode:UKR', types: 'street', limit: '20' }
    if (settlement.coordinates) parameters.at = `${settlement.coordinates.latitude},${settlement.coordinates.longitude}`
    const items = await hereRequest('autocomplete', parameters, signal)
    const unique = new Set<string>()
    return items.filter(item => (item.resultType === 'street' || item.resultType === 'streetSection') && matchesSettlement(item, settlement) && Boolean(item.address?.street))
        .filter(item => { const key = normalizePlace(item.address!.street!); if (unique.has(key)) return false; unique.add(key); return true })
}

export function savedAddressParts(address: string, settlement?: SelectedSettlement | null): { street: string; house: string } {
    const parts = address.split(',').map(part => part.trim())
    if (!settlement || normalizePlace(parts[0] || '') !== normalizePlace(settlement.name)) return { street: '', house: '' }
    const street = parts[1] || ''
    const house = parts[2] || ''
    return { street: [settlement.district, settlement.region].includes(street) ? '' : street, house: [settlement.district, settlement.region].includes(house) ? '' : house }
}

export async function resolveSettlement(settlement: Settlement, signal?: AbortSignal): Promise<SelectedSettlement> {
    const query = [settlement.name, settlement.type === 'city' ? '' : settlement.district, settlement.region, 'Україна'].filter(Boolean).join(', ')
    const [items, siblings] = await Promise.all([
        hereRequest('geocode', { q: query, in: 'countryCode:UKR', limit: '20' }, signal),
        findSettlements(settlement.name, signal),
    ])
    // HERE lacks hromada identity. Do not guess between namesakes in one raion.
    const ambiguous = siblings.some(other => other.code !== settlement.code && normalizePlace(other.name) === normalizePlace(settlement.name) && other.region === settlement.region && (other.district === settlement.district || settlement.type === 'city'))
    if (ambiguous) throw new Error('У цьому районі є однойменні населені пункти. HERE потребує уточнення вулиці та будинку; центр автоматично не обрано.')
    let matches = items.filter(item => item.resultType === 'locality' && matchesSettlement(item, settlement) && item.position)
    const uniqueInRegion = siblings.filter(other => normalizePlace(other.name) === normalizePlace(settlement.name) && other.region === settlement.region).length === 1
    if (!matches.length && uniqueInRegion) {
        const fallback = await hereRequest('geocode', { q: [settlement.name, settlement.region, 'Україна'].join(', '), in: 'countryCode:UKR', limit: '20' }, signal)
        matches = fallback.filter(item => item.resultType === 'locality' && matchesSettlement(item, settlement, true) && item.position)
    }
    const unique = matches.filter((item, index) => matches.findIndex(other => other.id === item.id) === index)
    if (unique.length !== 1) throw new Error('HERE не підтвердив однозначне місце цього населеного пункту. Уточніть адресу або вкажіть координати вручну.')
    const item = unique[0]
    const hereDistrict = [item.address?.city, item.address?.county].find(value => value && /район|р-н/u.test(value))
    return { ...settlement, hereId: item.id, hereDistrict, coordinates: { latitude: item.position!.lat, longitude: item.position!.lng } }
}

export async function findSettlements(query: string, signal?: AbortSignal): Promise<Settlement[]> {
    const response = await fetch((import.meta.env.VITE_API_URL ?? '') + '/api/settlements?' + new URLSearchParams({ q: query }), { signal: signal ?? AbortSignal.timeout(12000) })
    if (!response.ok) throw new Error('Не вдалося завантажити населені пункти. Спробуйте ще раз.')
    return (await response.json()).settlements
}
