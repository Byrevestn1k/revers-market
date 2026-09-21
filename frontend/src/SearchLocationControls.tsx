import { useCallback, useEffect, useRef, useState } from 'react'
import AddressInput from './AddressInput'
import { validCoordinates, type AddressValue, type Coordinates } from './address-model'
import { CITIES, CITY_KEY, normalizeCity, parseIpCity, profileSearchAddress, savedSearchCity, type HomeCity } from './search-location-model'

type Request = (path: string, options?: RequestInit) => Promise<any>
async function geocode(query: string, reverse?: Coordinates) {
    const apiKey = import.meta.env.VITE_HERE_API_KEY
    if (!apiKey) return null
    const params = new URLSearchParams({ lang: 'uk-UA', apiKey, limit: '1' })
    if (reverse) params.set('at', `${reverse.latitude},${reverse.longitude}`)
    else { params.set('q', query); params.set('in', 'countryCode:UKR') }
    const response = await fetch(`https://${reverse ? 'revgeocode' : 'geocode'}.search.hereapi.com/v1/${reverse ? 'revgeocode' : 'geocode'}?${params}`, { signal: AbortSignal.timeout(10000), credentials: 'omit', referrerPolicy: 'no-referrer' })
    return response.ok ? (await response.json()).items?.[0] ?? null : null
}
async function resolveCity(name: string, fallback?: Coordinates): Promise<HomeCity | null> {
    const known = CITIES.find(city => normalizeCity(city.name) === normalizeCity(name))
    if (known) return known
    try {
        const item = await geocode(name)
        if (item?.position) return { name: item.address?.city || name, latitude: item.position.lat, longitude: item.position.lng }
    } catch { /* A manually confirmed address can still supply the centre. */ }
    return fallback ? { name, ...fallback } : null
}
let ipLookup: Promise<HomeCity | null> | undefined
export function lookupIpCity() {
    return ipLookup ??= fetch('https://api.ipapi.is/', { signal: AbortSignal.timeout(6000), credentials: 'omit', referrerPolicy: 'no-referrer' })
        .then(response => response.ok ? response.json() : null).then(parseIpCity).catch(() => null)
}

export function useSearchLocation(request: Request, userId?: string, initialCity?: HomeCity, ready = true) {
    const [city, setCity] = useState<HomeCity | null>(() => initialCity ?? savedSearchCity())
    const [address, setAddress] = useState<AddressValue>({ address: '', city: city?.name ?? '', coordinates: null })
    const [busy, setBusy] = useState(false)
    const [addressBusy, setAddressBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [suggestion, setSuggestion] = useState<HomeCity | null>(null)
    const operation = useRef(0)
    const addressBusyChanged = useCallback((value: boolean) => {
        if (value) { operation.current++; setBusy(false) }
        setAddressBusy(value)
    }, [])
    const cityRef = useRef<HomeCity | null>(city); cityRef.current = city
    const remember = (next: HomeCity | null) => { try { if (next) localStorage.setItem(CITY_KEY, JSON.stringify(next)); else localStorage.removeItem(CITY_KEY) } catch { /* Optional storage. */ } }
    useEffect(() => {
        const version = ++operation.current
        const fallback = initialCity ?? savedSearchCity()
        setCity(fallback); setAddress({ address: '', city: fallback?.name ?? '', coordinates: null }); setSuggestion(null)
        setBusy(true); setMessage('')
        if (!ready) return () => { operation.current++ }
        const current = () => version === operation.current
        const load = async () => {
            if (userId) {
                try {
                    const { profile } = await request('/api/profile/me')
                    if (!current()) return
                    if (profile.exactAddress) {
                        let item = null
                        try { item = await geocode(profile.exactAddress) } catch { /* Keep the address, not a guessed home point. */ }
                        const { city: cityName, coordinates: addressPoint } = profileSearchAddress(profile, item)
                        const nextCity = await resolveCity(cityName, addressPoint ?? undefined)
                        if (!current()) return
                        if (nextCity) setCity(nextCity)
                        setAddress({ address: profile.exactAddress, city: nextCity?.name || cityName, coordinates: addressPoint })
                        setMessage(addressPoint ? 'Адреса з профілю. Зміни тут діють лише для пошуку.' : 'Адреса з профілю: уточніть її, щоб визначити будиночок на мапі.')
                        return
                    }
                    if (profile.location) {
                        const next = await resolveCity(profile.location)
                        if (next && current()) { setCity(next); setAddress({ address: '', city: next.name, coordinates: null }); return }
                    }
                } catch { if (current()) setMessage('Не вдалося завантажити адресу профілю. Можна обрати її для пошуку вручну.') }
            }
            if (!initialCity && !savedSearchCity()) {
                const candidate = await lookupIpCity()
                const localized = candidate ? await resolveCity(candidate.name, candidate) : null
                if (localized && current()) setSuggestion(localized)
            }
        }
        load().finally(() => { if (current()) setBusy(false) })
        return () => { operation.current++ }
    }, [userId, initialCity?.name, initialCity?.latitude, initialCity?.longitude, ready])
    const chooseCity = (next: HomeCity | null) => {
        operation.current++; setBusy(false); setSuggestion(null); setCity(next); remember(next)
        setAddress({ address: '', city: next?.name ?? '', coordinates: null }); setMessage(next ? 'Місто змінено лише для пошуку. Оберіть адресу для пошуку поруч.' : 'Місто не обрано — пошук відбуватиметься по всій Україні.')
    }
    const changeAddress = async (next: AddressValue) => {
        const version = ++operation.current
        setBusy(true); setSuggestion(null); setAddress(next)
        const nextCity = await resolveCity(next.city, next.coordinates ?? undefined)
        if (version !== operation.current) return
        if (nextCity) { setCity(nextCity); remember(nextCity) }
        setBusy(false); setMessage(validCoordinates(next.coordinates) ? 'Будиночок — ваша адреса пошуку. Профіль не змінено.' : 'Не вдалося визначити точку адреси. Уточніть адресу або натисніть «Моє місце».')
    }
    const locate = () => {
        const version = ++operation.current
        setSuggestion(null)
        if (!navigator.geolocation) { setBusy(false); setMessage('Геолокація недоступна. Оберіть адресу вручну.'); return }
        setBusy(true); setMessage('')
        navigator.geolocation.getCurrentPosition(async position => {
            const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude }
            let item = null
            try { item = await geocode('', coordinates) } catch { /* GPS point remains usable. */ }
            const nextCity = item?.address?.city ? await resolveCity(item.address.city, coordinates) : cityRef.current
            if (version !== operation.current) return
            if (nextCity) { setCity(nextCity); remember(nextCity) }
            setAddress({ address: item?.address?.label || 'Моє поточне місце', city: nextCity?.name || cityRef.current?.name || '', coordinates })
            setBusy(false); setMessage(item ? 'Будиночок встановлено за вашим поточним місцем.' : 'Точку визначено. Перевірте місто пошуку: адресу визначити не вдалося.')
        }, () => { if (version === operation.current) { setBusy(false); setMessage('Не вдалося визначити місце. Оберіть адресу вручну.') } }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
    }
    return { city, address, busy: busy || addressBusy, message, suggestion, chooseCity, changeAddress, locate, setAddressBusy: addressBusyChanged, dismissSuggestion: () => setSuggestion(null) }
}

export default function SearchLocationControls({ location, onNearby, nearbyDisabled, nearbyTitle }: { location: ReturnType<typeof useSearchLocation>; onNearby: () => void; nearbyDisabled: boolean; nearbyTitle: string }) {
    const { city, address, busy, message, suggestion } = location
    const cities = city && !CITIES.some(item => item.name === city.name) ? [...CITIES, city] : CITIES
    return <div className="map-location-group">
        <div className="map-city-controls">
            <label>Місто пошуку<select value={city?.name ?? ''} onChange={event => location.chooseCity(event.target.value ? cities.find(item => item.name === event.target.value)! : null)}><option value="">Не обрано — вся Україна</option>{cities.map(item => <option key={item.name}>{item.name}</option>)}</select></label>
            <div className="map-search-address"><span>Адреса пошуку</span><AddressInput value={address} onChange={location.changeAddress} onBusyChange={location.setAddressBusy} name="searchAddress" /></div>
            <button type="button" className="outline-button" onClick={location.locate} disabled={busy}>{busy ? 'Визначаємо…' : '⌖ Моє місце'}</button>
            <button type="button" className="primary-button compact map-nearby-button" disabled={nearbyDisabled} title={nearbyTitle} onClick={onNearby}>Знайти поруч</button>
        </div>
        {suggestion && <div className="map-city-suggestion" role="status">Ваше місто — {suggestion.name}? <small>Приблизно за IP · ipapi.is</small><button type="button" onClick={() => location.chooseCity(suggestion)}>Так</button><button type="button" onClick={location.dismissSuggestion}>Ні, оберу вручну</button></div>}
        {message && <p className="map-search-hint" role="status">{message}</p>}
    </div>
}
