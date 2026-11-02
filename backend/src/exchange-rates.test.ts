import { describe, expect, it, vi } from 'vitest'
import { ExchangeRates, parseRates } from './exchange-rates.js'

const now = Date.UTC(2026, 10, 2, 12)
const data = [
    { cc: 'USD', rate: 40.12, exchangedate: '02.11.2026' },
    { cc: 'EUR', rate: 45.34, exchangedate: '02.11.2026' },
    { cc: 'PLN', rate: 10.25, exchangedate: '02.11.2026' },
]
const response = (value: unknown, ok = true) => ({ ok, json: async () => value }) as Response

describe('official exchange rates', () => {
    it('validates complete, positive rates for one date', () => {
        expect(parseRates(data, now).rates).toEqual({ UAH: '1', USD: '40.12', EUR: '45.34', PLN: '10.25' })
        for (const invalid of [data.slice(0, 2), [...data, data[0]], data.map((row, i) => i ? row : { ...row, rate: 0 }), data.map((row, i) => i ? row : { ...row, exchangedate: '01.11.2026' }), data.map(row => ({ ...row, exchangedate: '20.10.2026' }))]) {
            expect(() => parseRates(invalid, now)).toThrow()
        }
    })
    it('shares simultaneous requests, caches and preserves snapshots', async () => {
        const fetcher = vi.fn(async () => response(data)) as unknown as typeof fetch
        const service = new ExchangeRates(fetcher, () => now)
        const [first, second] = await Promise.all([service.get(), service.get()])
        expect(first).toEqual(second)
        expect(await service.get(first!.id)).toEqual(first)
        expect(await service.get()).toEqual(first)
        expect(fetcher).toHaveBeenCalledTimes(1)
    })
    it('fails safely on HTTP, network and timeout failures and limits retries', async () => {
        for (const fetcher of [vi.fn(async () => response([], false)), vi.fn(async () => { throw new Error('network') }), vi.fn(async () => { throw new DOMException('timeout', 'TimeoutError') })]) {
            const service = new ExchangeRates(fetcher as unknown as typeof fetch, () => now)
            expect(await service.get()).toBeNull()
            expect(await service.get()).toBeNull()
            expect(fetcher).toHaveBeenCalledTimes(1)
        }
    })
    it('uses a recent validated fallback but rejects it after seven days', async () => {
        let time = now
        const fetcher = vi.fn().mockResolvedValueOnce(response(data)).mockRejectedValue(new Error('offline'))
        const service = new ExchangeRates(fetcher as unknown as typeof fetch, () => time)
        const first = await service.get()
        time += 13 * 3600000
        expect(await service.get()).toEqual({ ...first, stale: true })
        expect(await service.get(first!.id)).toEqual({ ...first, stale: true })
        time += 8 * 86400000
        expect(await service.get()).toBeNull()
    })
})
