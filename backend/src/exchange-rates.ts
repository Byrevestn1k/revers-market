import { createHash } from 'node:crypto'

const ENDPOINT = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchangenew?json'
const REFRESH_MS = 12 * 60 * 60 * 1000
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000
const RETRY_MS = 5 * 60 * 1000
export type Currency = 'UAH' | 'USD' | 'EUR' | 'PLN'
export type RateSet = { id: string; date: string; rates: Record<Currency, string>; fetchedAt: number; stale?: boolean }

export function parseRates(data: unknown, now = Date.now()): RateSet {
    if (!Array.isArray(data)) throw new Error('Invalid rates')
    const rates: Record<Currency, string> = { UAH: '1', USD: '', EUR: '', PLN: '' }
    let date = ''
    for (const currency of ['USD', 'EUR', 'PLN'] as const) {
        const matches = data.filter(row => row && row.cc === currency)
        if (matches.length !== 1) throw new Error('Incomplete rates')
        const row = matches[0]
        if (typeof row.rate !== 'number' || !Number.isFinite(row.rate) || row.rate <= 0 || !/^\d{2}\.\d{2}\.\d{4}$/.test(row.exchangedate)) throw new Error('Invalid rate')
        if (date && date !== row.exchangedate) throw new Error('Mixed dates')
        date = row.exchangedate
        rates[currency] = String(row.rate)
    }
    const [day, month, year] = date.split('.').map(Number)
    const rateDate = Date.UTC(year, month - 1, day)
    const parsed = new Date(rateDate)
    if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day || rateDate > now + 86400000 || now - rateDate > MAX_AGE_MS) throw new Error('Invalid rate date')
    const id = createHash('sha256').update(JSON.stringify({ date, rates })).digest('hex').slice(0, 24)
    return { id, date, rates, fetchedAt: now }
}

export class ExchangeRates {
    private current: RateSet | null = null
    private snapshots = new Map<string, RateSet>()
    private pending: Promise<RateSet | null> | null = null
    private nextAttempt = 0
    constructor(private fetcher: typeof fetch = fetch, private now = () => Date.now()) {}
    private usable(rate: RateSet | null) {
        if (!rate) return false
        const [day, month, year] = rate.date.split('.').map(Number)
        return this.now() - Date.UTC(year, month - 1, day) <= MAX_AGE_MS
    }
    async get(id?: string): Promise<RateSet | null> {
        if (id) { const snapshot = this.snapshots.get(id) ?? null; return this.usable(snapshot) ? (this.now() - snapshot!.fetchedAt >= REFRESH_MS || this.nextAttempt > this.now() ? { ...snapshot!, stale: true } : snapshot) : null }
        if (this.current && this.now() - this.current.fetchedAt < REFRESH_MS && this.usable(this.current)) return this.current
        if (this.pending) return this.pending
        if (this.now() < this.nextAttempt) return this.usable(this.current) ? { ...this.current!, stale: true } : null
        this.pending = (async () => {
            try {
                const response = await this.fetcher(ENDPOINT, { signal: AbortSignal.timeout(8000) })
                if (!response.ok) throw new Error('NBU unavailable')
                const rate = parseRates(await response.json(), this.now())
                this.current = rate
                this.snapshots.set(rate.id, rate)
                for (const [key, value] of this.snapshots) if (!this.usable(value)) this.snapshots.delete(key)
                this.nextAttempt = 0
                return rate
            } catch {
                this.nextAttempt = this.now() + RETRY_MS
                return this.usable(this.current) ? { ...this.current!, stale: true } : null
            } finally { this.pending = null }
        })()
        return this.pending
    }
}
export const exchangeRates = new ExchangeRates()
