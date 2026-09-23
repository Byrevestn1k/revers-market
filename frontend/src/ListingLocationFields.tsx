import { useEffect, useState } from 'react'
import AddressInput from './AddressInput'
import SettlementPicker from './SettlementPicker'
import { resolveSettlement, findSettlements, matchesSettlement, type Settlement } from './settlement-model'
import { validCoordinates, type AddressValue } from './address-model'
import { FieldError } from './ListingFields'

export default function ListingLocationFields({ value, onChange, request, error, onBusyChange }: {
    value: AddressValue; onChange: (value: AddressValue) => void
    request: (path: string, options?: RequestInit) => Promise<any>; error?: string; onBusyChange?: (busy: boolean) => void
}) {
    const [busy, setBusy] = useState(false)
    const [addressBusy, setAddressBusy] = useState(false)
    useEffect(() => { onBusyChange?.(busy || addressBusy); return () => onBusyChange?.(false) }, [busy, addressBusy, onBusyChange])
    const [message, setMessage] = useState('')
    const [manualLatitude, setManualLatitude] = useState('')
    const [manualLongitude, setManualLongitude] = useState('')
    const change = (next: AddressValue) => { onChange(next); setMessage(''); setManualLatitude(''); setManualLongitude('') }
    const fromProfile = async () => {
        setBusy(true); setMessage('')
        try {
            const { profile } = await request('/api/profile/me')
            const address = profile.exactAddress || ''
            if (!address && !profile.location) { setMessage('У профілі ще немає адреси. Скористайтеся кнопкою «Обрати адресу».'); return }
            let next: AddressValue = { address, city: profile.addressSettlement?.name || profile.location || '', settlement: profile.addressSettlement ?? profile.settlement, coordinates: profile.addressCoordinates ?? null }
            const apiKey = import.meta.env.VITE_HERE_API_KEY
            if (apiKey && !next.coordinates) {
                const response = await fetch('https://geocode.search.hereapi.com/v1/geocode?' + new URLSearchParams({ q: address || profile.location, in: 'countryCode:UKR', lang: 'uk-UA', limit: '1', apiKey }), { signal: AbortSignal.timeout(12000) })
                if (response.ok) {
                    const item = (await response.json()).items?.[0]
                    if (item?.position && (!next.settlement || matchesSettlement(item, next.settlement))) next = { ...next, city: next.settlement?.name || item.address?.district || next.city || item.address?.city || '', coordinates: { latitude: item.position.lat, longitude: item.position.lng } }
                }
            }
            change(next)
        } catch { setMessage('Не вдалося завантажити місце. Оберіть адресу або вкажіть координати вручну.') }
        finally { setBusy(false) }
    }
    const locate = () => {
        if (!navigator.geolocation) { setMessage('Визначення місця недоступне. Оберіть адресу.'); return }
        setBusy(true); setMessage('')
        navigator.geolocation.getCurrentPosition(async (position) => {
            const coordinates = { latitude: position.coords.latitude, longitude: position.coords.longitude }
            let city = ''
            let settlement: Settlement | null = null
            try {
                const apiKey = import.meta.env.VITE_HERE_API_KEY
                if (apiKey) {
                    const response = await fetch('https://revgeocode.search.hereapi.com/v1/revgeocode?' + new URLSearchParams({ at: coordinates.latitude + ',' + coordinates.longitude, lang: 'uk-UA', apiKey }), { signal: AbortSignal.timeout(12000) })
                    if (response.ok) {
                        const item = (await response.json()).items?.[0]
                        city = item?.address?.district || item?.address?.city || ''
                        const matches = (await findSettlements(city)).filter(candidate => matchesSettlement(item, candidate))
                        if (matches.length === 1) { settlement = matches[0]; city = settlement.name }
                    }
                }
            } catch { /* Keep the GPS point and let the user supply its city. */ }
            change({ address: '', city: settlement?.name ?? '', settlement, coordinates }); setBusy(false)
            if (!settlement) setMessage('Точку визначено. Оберіть населений пункт із підказок нижче.')
        }, () => { setBusy(false); setMessage('Не вдалося визначити місце. Оберіть адресу вручну.') }, { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 })
    }
    const setManual = (latitude: string, longitude: string) => {
        setManualLatitude(latitude); setManualLongitude(longitude)
        const coordinates = latitude.trim() && longitude.trim() ? { latitude: Number(latitude), longitude: Number(longitude) } : null
        onChange({ ...value, address: '', coordinates: validCoordinates(coordinates) ? coordinates : null })
    }
    const chooseSettlement = async (item: Settlement | null) => {
        if (!item) return
        setBusy(true); setMessage('')
        const next: AddressValue = { address: '', city: item.name, settlement: item, coordinates: value.settlement?.code === item.code || (!value.city && !value.settlement) ? value.coordinates : null }
        try { const resolved = await resolveSettlement(item); change({ ...next, settlement: resolved, coordinates: next.coordinates ?? resolved.coordinates ?? null }) }
        catch (error) { change(next); setMessage((error as Error).message) }
        finally { setBusy(false) }
    }
    const visibility = value.addressVisibility ?? 'private'
    const setVisibility = (addressVisibility: 'private' | 'public') => change({ ...value, addressVisibility, addressVisibilityConsent: addressVisibility === 'private' ? false : value.addressVisibilityConsent })
    return <fieldset className="listing-section" disabled={busy}><legend>Адреса товару</legend>
        <AddressInput value={value} onChange={change} onBusyChange={setAddressBusy} name="address" requireStreet={false} />
        <label>Видимість цієї адреси<select value={visibility} onChange={(event) => setVisibility(event.target.value as 'private' | 'public')}><option value="private">Приблизна точка на мапі — адреса прихована</option><option value="public">Показувати точну адресу й точку всім</option></select></label>
        {visibility === 'public' && <div className="field-error" role="status"><strong>Адреса стане публічною.</strong> Перевага: покупцям простіше знайти офіційний магазин або місце видачі. Ризик: будь-хто побачить адресу, зможе приїхати туди та пов’язати її з оголошенням.<label className="consent-row"><input type="checkbox" checked={value.addressVisibilityConsent === true} onChange={(event) => change({ ...value, addressVisibilityConsent: event.target.checked })} />Розумію наслідки й погоджуюся показувати цю адресу всім.</label></div>}
        <div className="listing-location-actions"><button type="button" className="outline-button compact" onClick={fromProfile}>Адреса з профілю</button><button type="button" className="outline-button compact" onClick={locate}>⌖ Моє місце</button></div>
        <SettlementPicker label="Населений пункт, видимий іншим" value={value.settlement} legacyName={value.city} onChange={chooseSettlement} disabled={busy || addressBusy} />
        <p className="listing-location-note">Адреса отримання цього оголошення приватна. За замовчуванням місце на мапі приблизне. Для товарів можна окремо дозволити показ адреси профілю або власної точки в налаштуваннях профілю.</p>
        <p className="listing-location-note" role="status">{busy ? 'Визначаємо місце…' : validCoordinates(value.coordinates) ? '✓ Точку для мапи визначено' : 'Точку на мапі можна вказати додатково.'}</p>
        <details className="listing-location-coordinates"><summary>Переглянути або ввести координати вручну</summary><div className="field-row">
            <label>Широта<input type="number" step="any" min="-90" max="90" value={manualLatitude || value.coordinates?.latitude?.toString() || ''} onChange={(event) => setManual(event.target.value, manualLongitude || value.coordinates?.longitude?.toString() || '')} /></label>
            <label>Довгота<input type="number" step="any" min="-180" max="180" value={manualLongitude || value.coordinates?.longitude?.toString() || ''} onChange={(event) => setManual(manualLatitude || value.coordinates?.latitude?.toString() || '', event.target.value)} /></label>
        </div></details>
        {message && <p className="listing-location-note" role="status">{message}</p>}<FieldError message={error} />
    </fieldset>
}
