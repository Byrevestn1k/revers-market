import { useEffect, useRef, useState } from 'react'

type HereItem = { id: string; title: string; resultType?: string; address?: { label?: string; city?: string; street?: string; county?: string; countryName?: string }; position?: { lat: number; lng: number } }

export default function AddressInput({ initialValue }: { initialValue: string }) {
    const [open, setOpen] = useState(false)
    const [city, setCity] = useState('')
    const [cityPosition, setCityPosition] = useState<{ lat: number; lng: number } | null>(null)
    const [street, setStreet] = useState('')
    const [house, setHouse] = useState('')
    const [citySelected, setCitySelected] = useState(false)
    const [locatingCity, setLocatingCity] = useState(false)
    const [cityResults, setCityResults] = useState<HereItem[]>([])
    const [streetResults, setStreetResults] = useState<HereItem[]>([])
    const [error, setError] = useState('')
    const cityRef = useRef<HTMLInputElement>(null)
    const version = useRef(0)
    const apiKey = import.meta.env.VITE_HERE_API_KEY
    const address = [city, street, house].filter(Boolean).join(', ')
    const cityTitle = (item: HereItem) => item.address?.city || item.title
    const cityDetail = (item: HereItem) => [item.address?.county, item.address?.countryName].filter((part, index, all) => Boolean(part) && all.indexOf(part) === index).join(', ')
    const streetTitle = (item: HereItem) => item.address?.street || item.title
    const streetDetail = (item: HereItem) => [item.address?.city, item.address?.county, item.address?.countryName].filter((part, index, all) => Boolean(part) && all.indexOf(part) === index).join(', ')

    const search = async (query: string, type: 'city' | 'street', position?: { lat: number; lng: number } | null) => {
        const request = ++version.current
        if (!apiKey || query.trim().length < (type === 'city' ? 2 : 3)) return [] as HereItem[]
        const params = new URLSearchParams({ q: query.trim(), types: type, in: position ? `circle:${position.lat},${position.lng};r=50000` : 'countryCode:UKR', lang: 'uk-UA', limit: '8', apiKey })
        try {
            const response = await fetch(`https://autocomplete.search.hereapi.com/v1/autocomplete?${params}`)
            if (!response.ok) throw new Error('HERE search failed')
            const data = await response.json() as { items?: HereItem[] }
            return request === version.current ? data.items ?? [] : []
        } catch {
            if (request === version.current) setError('Підказки адрес тимчасово недоступні.')
            return []
        }
    }
    const searchStreets = async (query: string) => {
        const request = ++version.current
        if (!apiKey || !cityPosition || query.trim().length < 3) return [] as HereItem[]
        try {
            const params = new URLSearchParams({ q: query.trim(), in: `circle:${cityPosition.lat},${cityPosition.lng};r=50000`, lang: 'uk-UA', limit: '12', apiKey })
            const response = await fetch(`https://autosuggest.search.hereapi.com/v1/autosuggest?${params}`)
            if (!response.ok) throw new Error('HERE autosuggest failed')
            const data = await response.json() as { items?: HereItem[] }
            return request === version.current ? (data.items ?? []).filter(item => item.resultType === 'street') : []
        } catch { if (request === version.current) setError('Підказки адрес тимчасово недоступні.'); return [] }
    }
    useEffect(() => { if (citySelected) return; const timer = window.setTimeout(() => search(city, 'city').then(setCityResults), 400); return () => window.clearTimeout(timer) }, [city, citySelected])
    useEffect(() => { if (!citySelected || street.trim().length < 3) { setStreetResults([]); return }; const timer = window.setTimeout(() => searchStreets(street).then(setStreetResults), 400); return () => window.clearTimeout(timer) }, [street, citySelected, cityPosition])
    const resetCity = (value: string) => { setCity(value); setCityPosition(null); setCitySelected(false); setCityResults([]); setStreet(''); setHouse(''); setError('') }
    const chooseCity = async (item: HereItem) => {
        version.current++; setCity([cityTitle(item), cityDetail(item)].filter(Boolean).join(', ')); setCitySelected(true); setCityResults([]); setStreet(''); setHouse(''); setCityPosition(null); setLocatingCity(true)
        try {
            const params = new URLSearchParams({ id: item.id, apiKey })
            const response = await fetch(`https://lookup.search.hereapi.com/v1/lookup?${params}`)
            const data = await response.json() as HereItem
            if (!data.position) throw new Error('No city position')
            setCityPosition(data.position)
        } catch { setError('Не вдалося визначити місце міста для пошуку вулиць.') }
        finally { setLocatingCity(false) }
    }

    return <div className="address-editor"><input type="hidden" name="exactAddress" value={address || initialValue} />
        <div className="phone-display"><input value={address || initialValue} readOnly placeholder="Адресу не вказано" /><button type="button" className="avatar-edit inline-edit" aria-label="Редагувати точну адресу" onClick={() => { setOpen(true); window.setTimeout(() => cityRef.current?.focus(), 0) }}>✎</button></div>
        {open && <div className="address-dialog-backdrop" onMouseDown={() => setOpen(false)}><div className="address-popup" role="dialog" aria-modal="true" aria-label="Редагування точної адреси" onMouseDown={event => event.stopPropagation()}><button type="button" className="modal-close" aria-label="Закрити" onClick={() => setOpen(false)}>×</button><strong>Точна адреса</strong>
            <label>Місто<input ref={cityRef} value={city} placeholder="Почніть вводити місто" onChange={event => resetCity(event.target.value)} />{!citySelected && cityResults.length > 0 && <div className="address-results">{cityResults.map((item, index) => <button type="button" key={`${item.title}-${index}`} onClick={() => chooseCity(item)}><b>{cityTitle(item)}</b><small>{cityDetail(item)}</small></button>)}</div>}</label>
            {citySelected && <div className="address-street-row"><label>Вулиця<input value={street} disabled={locatingCity || !cityPosition} placeholder={locatingCity ? 'Визначаємо місто…' : 'Почніть вводити вулицю'} onChange={event => { setStreet(event.target.value); setError('') }} />{streetResults.length > 0 && <div className="address-results">{streetResults.map((item, index) => <button type="button" key={`${item.title}-${index}`} onClick={() => { version.current++; setStreet(streetTitle(item)); setStreetResults([]) }}><b>{streetTitle(item)}</b><small>{streetDetail(item)}</small></button>)}</div>}</label><label>№ будинку<input value={house} disabled={!street} placeholder="12-А" onFocus={() => { version.current++; setCityResults([]); setStreetResults([]) }} onChange={event => setHouse(event.target.value)} /></label></div>}
            {error && <span className="field-error">{error}</span>}<button type="button" className="primary-button compact" disabled={!citySelected || !street || !house} onClick={() => setOpen(false)}>Застосувати</button>
        </div></div>}
    </div>
}
