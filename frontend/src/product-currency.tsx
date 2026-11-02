import { useEffect, useState } from 'react'

type Currency = 'UAH' | 'USD' | 'EUR' | 'PLN'
type Rates = { id: string; date: string; rates: Record<Currency, string>; fetchedAt: number; stale?: boolean }
type Choice = Currency | 'seller'
let choice: Choice = (() => { try { const saved = localStorage.getItem('productDisplayCurrency'); return ['UAH', 'USD', 'EUR', 'PLN'].includes(saved ?? '') ? saved as Currency : 'seller' } catch { return 'seller' } })()
let rates: Rates | null = null
let pending: Promise<void> | null = null
let failed = false
let revision = 0
let pinned = false
const listeners = new Set<() => void>()
let timer: number | undefined
const update = () => listeners.forEach(listener => listener())
export function useRateSet(next: Rates) { revision++; pinned = true; rates = next; failed = false; update() }
export function releaseRateSet() { pinned = false; if (choice !== 'seller') load() }
function valid(value: Rates) { const [day, month, year] = value.date.split('.').map(Number); return Date.now() - Date.UTC(year, month - 1, day) <= 7 * 86400000 }
function load() {
    if (pending || (rates && valid(rates) && (pinned || Date.now() - rates.fetchedAt < 12 * 3600000))) return
    const requestRevision = revision
    pending = fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/exchange-rates`).then(async response => {
        if (!response.ok) throw new Error('rates')
        const received = (await response.json()).rates
        if (requestRevision === revision) { rates = received; failed = false }
    }).catch(() => { if (requestRevision === revision) failed = true }).finally(() => { pending = null; update() })
}
function useCurrency() {
    const [, refresh] = useState(0)
    useEffect(() => { const listener = () => refresh(value => value + 1); listeners.add(listener); if (choice !== 'seller') load(); if (timer === undefined) timer = window.setInterval(() => { if (!pinned && choice !== 'seller') load(); update() }, 60000); return () => { listeners.delete(listener); if (!listeners.size && timer !== undefined) { clearInterval(timer); timer = undefined } } }, [])
    return { choice, rates, failed }
}
export function CurrencySelector() {
    const state = useCurrency()
    return <><label>Показувати ціни: <select value={state.choice} onChange={event => { choice = event.target.value as Choice; try { localStorage.setItem('productDisplayCurrency', choice) } catch { /* storage is optional */ }; if (choice !== 'seller') load(); update() }}><option value="seller">Валюта продавця</option><option>UAH</option><option>USD</option><option>EUR</option><option>PLN</option></select></label>{state.choice !== 'seller' && state.rates && valid(state.rates) && <small> Курс НБУ від {state.rates.date}{(state.rates.stale || Date.now() - state.rates.fetchedAt > 12 * 3600000) ? ' (збережений)' : ''}</small>}</>
}
function decimal(value: string): [bigint, bigint] {
    const [whole, fraction = ''] = value.split('.')
    return [BigInt(whole + fraction), 10n ** BigInt(fraction.length)]
}
export function convert(amount: number, source: string, target: Currency, set: Rates): string | null {
    if (!Object.hasOwn(set.rates, source) || !Number.isFinite(amount) || amount < 0) return null
    const [a, ad] = decimal(amount.toFixed(2)); const [s, sd] = decimal(set.rates[source as Currency]); const [t, td] = decimal(set.rates[target])
    const numerator = a * s * td * 100n; const denominator = ad * sd * t
    const cents = (numerator * 2n + denominator) / (2n * denominator)
    return `${cents / 100n},${String(cents % 100n).padStart(2, '0')}`
}
export function ConvertedPrice({ amount, currency, detail = false }: { amount: number; currency: string; detail?: boolean }) {
    const state = useCurrency()
    if (state.choice === 'seller' || state.choice === currency) return null
    if (!state.rates || !valid(state.rates)) return state.failed || state.rates ? <small>Перерахунок тимчасово недоступний</small> : null
    const value = convert(amount, currency, state.choice, state.rates)
    if (!value) return <small>Перерахунок тимчасово недоступний</small>
    return <small style={{ display: 'block' }}>≈ {value} {state.choice}{(state.rates.stale || Date.now() - state.rates.fetchedAt > 12 * 3600000) && <span> · Збережений курс</span>}{detail && <span> · Перераховано за офіційним курсом НБУ від {state.rates.date}. Фактична ціна продавця — {amount} {currency}.</span>}</small>
}
