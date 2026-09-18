import { useEffect, useRef, useState } from 'react'
import type { AddressValue } from './address-model'
import { validCoordinates } from './address-model'
import './listing-ui.css'

type HereItem = { id: string; title: string; resultType?: string; address?: { city?: string; street?: string; county?: string; countryName?: string }; position?: { lat: number; lng: number } }
type Props = { initialValue?: string; value?: AddressValue; onChange?: (value: AddressValue) => void; onBusyChange?: (busy: boolean) => void; name?: string; requireStreet?: boolean }
export default function AddressInput({ initialValue = '', value, onChange, onBusyChange, name = 'exactAddress', requireStreet = true }: Props) {
    const [saved, setSaved] = useState(initialValue)
    const [open, setOpen] = useState(false)
    const [city, setCity] = useState('')
    const [street, setStreet] = useState('')
    const [house, setHouse] = useState('')
    const [cityPosition, setCityPosition] = useState<{ lat: number; lng: number } | null>(null)
    const [cityChosen, setCityChosen] = useState(false)
    const [streetChosen, setStreetChosen] = useState(false)
    const [cityResults, setCityResults] = useState<HereItem[]>([])
    const [streetResults, setStreetResults] = useState<HereItem[]>([])
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const cityRef = useRef<HTMLInputElement>(null)
    const editButton = useRef<HTMLButtonElement>(null)
    const operation = useRef(0)
    const apiKey = import.meta.env.VITE_HERE_API_KEY
    const committed = value ? value.address || value.city : saved
    useEffect(() => setSaved(initialValue), [initialValue])
    useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
    useEffect(() => () => { operation.current++ }, [])
    const close = () => { operation.current++; setOpen(false); setBusy(false); editButton.current?.focus() }
    useEffect(() => {
        if (!open) return
        cityRef.current?.focus()
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
        window.addEventListener('keydown', escape)
        return () => window.removeEventListener('keydown', escape)
    }, [open])
    useEffect(() => {
        if (!open || cityChosen || city.trim().length < 2 || !apiKey) { setCityResults([]); return }
        const controller = new AbortController()
        const timer = window.setTimeout(async () => {
            try {
                const params = new URLSearchParams({ q: city.trim(), types: 'city', in: 'countryCode:UKR', lang: 'uk-UA', limit: '8', apiKey })
                const response = await fetch('https://autocomplete.search.hereapi.com/v1/autocomplete?' + params, { signal: controller.signal })
                if (!response.ok) throw new Error()
                const data = await response.json()
                if (!controller.signal.aborted) setCityResults(data.items ?? [])
            } catch { if (!controller.signal.aborted) setError('Підказки недоступні. Можна ввести адресу вручну.') }
        }, 350)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [city, cityChosen, open, apiKey])
    useEffect(() => {
        if (!open || !city.trim() || streetChosen || street.trim().length < 3 || !apiKey) { setStreetResults([]); return }
        const controller = new AbortController()
        const timer = window.setTimeout(async () => {
            try {
                const params = new URLSearchParams({ q: cityPosition ? street.trim() : city + ' ' + street, in: cityPosition ? 'circle:' + cityPosition.lat + ',' + cityPosition.lng + ';r=50000' : 'countryCode:UKR', lang: 'uk-UA', limit: '8', apiKey })
                if (!cityPosition) params.set('types', 'street')
                const response = await fetch((cityPosition ? 'https://autosuggest.search.hereapi.com/v1/autosuggest?' : 'https://autocomplete.search.hereapi.com/v1/autocomplete?') + params, { signal: controller.signal })
                if (!response.ok) throw new Error()
                const data = await response.json()
                if (!controller.signal.aborted) setStreetResults((data.items ?? []).filter((item: HereItem) => item.resultType === 'street'))
            } catch { if (!controller.signal.aborted) setError('Підказки недоступні. Можна ввести вулицю вручну.') }
        }, 350)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [city, cityPosition, street, streetChosen, open, apiKey])
    const begin = () => {
        operation.current++
        const parts = committed.split(',').map((part) => part.trim())
        setCity(value?.city || (parts[0] ?? '').replace(/^м\.\s*/i, ''))
        setStreet(parts[1] ?? ''); setHouse(parts.slice(2).join(', '))
        setCityPosition(null); setCityChosen(false); setStreetChosen(false)
        setCityResults([]); setStreetResults([]); setError(''); setOpen(true)
    }
    const chooseCity = async (item: HereItem) => {
        const current = ++operation.current
        setCity(item.address?.city || item.title); setCityChosen(true); setCityResults([]); setStreet(''); setHouse(''); setStreetChosen(false); setCityPosition(null); setError('')
        if (item.position) { setCityPosition(item.position); return }
        try {
            const response = await fetch('https://lookup.search.hereapi.com/v1/lookup?' + new URLSearchParams({ id: item.id, apiKey }))
            if (!response.ok) return
            const data = await response.json()
            if (current === operation.current && data.position) setCityPosition(data.position)
        } catch { /* Manual street entry remains available. */ }
    }
    const apply = async () => {
        const address = [city.trim(), street.trim(), house.trim()].filter(Boolean).join(', ')
        const current = ++operation.current
        let coordinates = address === committed && validCoordinates(value?.coordinates) ? value.coordinates : null
        setBusy(true); setError('')
        setCityResults([]); setStreetResults([])
        if (apiKey) {
            try {
                const params = new URLSearchParams({ q: address, in: 'countryCode:UKR', lang: 'uk-UA', limit: '3', apiKey })
                if (cityPosition) params.set('at', cityPosition.lat + ',' + cityPosition.lng)
                const response = await fetch('https://geocode.search.hereapi.com/v1/geocode?' + params, { signal: AbortSignal.timeout(12000) })
                if (!response.ok) throw new Error()
                const data = await response.json()
                const normalize = (name: string) => name.replace(/^м\.\s*/i, '').trim().toLocaleLowerCase('uk-UA')
                const match = (data.items ?? []).find((item: HereItem) => item.position && normalize(item.address?.city || '') === normalize(city))
                if (match?.position) coordinates = { latitude: match.position.lat, longitude: match.position.lng }
            } catch { /* A location can also be entered using manual coordinates. */ }
        }
        if (current !== operation.current) return
        const next = { address, city: city.trim(), coordinates: validCoordinates(coordinates) ? coordinates : null }
        setSaved(address); onChange?.(next); close()
    }
    return <div className="address-editor"><input type="hidden" name={name} value={value?.address ?? saved} />
        <div className="address-display"><input value={committed} readOnly placeholder="Оберіть населений пункт та адресу" aria-label="Обрана адреса" /><button ref={editButton} type="button" className="outline-button compact" onClick={begin}>{committed ? 'Змінити адресу' : 'Обрати адресу'}</button></div>
        {open && <div className="address-dialog-backdrop" onMouseDown={close}><div className="address-popup" role="dialog" aria-modal="true" aria-label="Вибір адреси" onMouseDown={(event) => event.stopPropagation()}>
            <button type="button" className="modal-close" aria-label="Закрити адресу" onClick={close}>×</button><strong>Вибір адреси</strong>
            <p>{requireStreet ? 'Оберіть населений пункт, вулицю та будинок.' : 'Оберіть населений пункт. Вулиця й будинок допоможуть точніше визначити місце на мапі.'}</p>
            <label>Місто або населений пункт<input ref={cityRef} value={city} disabled={busy} maxLength={160} autoComplete="off" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} onChange={(event) => { operation.current++; setCity(event.target.value); setCityPosition(null); setCityChosen(false); setStreet(''); setHouse(''); setError('') }} placeholder="Наприклад, Рівне" />
                {!cityChosen && cityResults.length > 0 && <div className="address-results">{cityResults.map((item) => <button type="button" key={item.id} onClick={() => chooseCity(item)}><b>{item.address?.city || item.title}</b><small>{[item.address?.county, item.address?.countryName].filter(Boolean).join(', ')}</small></button>)}</div>}
            </label>
            <div className="address-street-row"><label>Вулиця<input value={street} disabled={busy || !city.trim()} maxLength={200} autoComplete="off" placeholder="Назва вулиці" onKeyDown={(event) => { if (event.key === 'Enter') event.preventDefault() }} onChange={(event) => { setStreet(event.target.value); setHouse(''); setStreetChosen(false); setError('') }} />
                {streetResults.length > 0 && <div className="address-results">{streetResults.map((item) => <button type="button" key={item.id} onClick={() => { setStreet(item.address?.street || item.title); setStreetChosen(true); setStreetResults([]) }}><b>{item.address?.street || item.title}</b><small>{item.address?.city}</small></button>)}</div>}
            </label><label>Будинок<input value={house} disabled={busy || !street.trim()} maxLength={40} placeholder="12-А" onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); if (!busy && city.trim()) apply() } }} onChange={(event) => setHouse(event.target.value)} /></label></div>
            {error && <span className="field-error" role="status">{error}</span>}
            <div className="address-dialog-actions"><button type="button" className="outline-button" onClick={close}>Скасувати</button><button type="button" className="primary-button" disabled={busy || city.trim().length < 2 || (requireStreet && (!street.trim() || !house.trim()))} onClick={apply}>{busy ? 'Визначаємо місце…' : 'Застосувати'}</button></div>
        </div></div>}
    </div>
}
