import { useEffect, useState } from 'react'
import AddressInput from './AddressInput'
import LocationPointPicker from './LocationPointPicker'
import { validCoordinates, type AddressValue, type ListingMapLocationMode } from './address-model'
import { FieldError } from './ListingFields'

type ProfileLocation = { location?: string | null; settlement?: AddressValue['settlement']; addressSettlement?: AddressValue['settlement']; addressCoordinates?: AddressValue['coordinates']; mapLocation?: { mode?: string; latitude?: number | null; longitude?: number | null } }

export default function ListingLocationFields({ value, onChange, request, error, onBusyChange }: {
    value: AddressValue; onChange: (value: AddressValue) => void
    request: (path: string, options?: RequestInit) => Promise<any>; error?: string; onBusyChange?: (busy: boolean) => void
}) {
    const [busy, setBusy] = useState(false)
    const [addressBusy, setAddressBusy] = useState(false)
    const [message, setMessage] = useState('')
    const mode: ListingMapLocationMode = value.mapLocationMode ?? 'profile'
    const change = (next: AddressValue) => { onChange(next); setMessage('') }
    const applyProfileLocation = async () => {
        setBusy(true); setMessage('')
        try {
            const { profile } = await request('/api/profile/me') as { profile: ProfileLocation }
            const mapCandidate = profile.mapLocation?.latitude != null && profile.mapLocation.longitude != null ? { latitude: Number(profile.mapLocation.latitude), longitude: Number(profile.mapLocation.longitude) } : null
            const profilePoint = validCoordinates(mapCandidate) ? mapCandidate : validCoordinates(profile.addressCoordinates) ? profile.addressCoordinates : null
            const settlement = profile.mapLocation?.mode && profile.mapLocation.mode !== 'approximate' ? profile.settlement ?? profile.addressSettlement : profile.addressSettlement ?? profile.settlement
            change({ ...value, address: '', city: settlement?.name ?? profile.location ?? '', settlement, coordinates: profilePoint, addressVisibility: 'private', addressVisibilityConsent: false, mapLocationMode: 'profile' })
            if (!profilePoint) setMessage('У профілі ще не визначено місце. Оберіть точку або адресу для цього оголошення.')
        } catch { setMessage('Не вдалося завантажити місце з профілю.') }
        finally { setBusy(false) }
    }
    useEffect(() => { onBusyChange?.(busy || addressBusy); return () => onBusyChange?.(false) }, [busy, addressBusy, onBusyChange])
    useEffect(() => { if (!value.mapLocationMode) void applyProfileLocation() }, [])
    const setMode = (nextMode: ListingMapLocationMode) => {
        if (nextMode === 'profile') { void applyProfileLocation(); return }
        change({ ...value, address: nextMode === 'pin' ? '' : value.address, addressVisibility: 'private', addressVisibilityConsent: false, mapLocationMode: nextMode })
    }
    const setPoint = (coordinates: AddressValue['coordinates']) => change({ ...value, coordinates, mapLocationMode: 'pin', address: '', addressVisibility: 'private', addressVisibilityConsent: false })
    const visibility = value.addressVisibility ?? 'private'
    return <fieldset className="listing-section" disabled={busy}><legend>Місце оголошення на мапі</legend>
        <label>Публічна точка цього оголошення<select value={mode} onChange={(event) => setMode(event.target.value as ListingMapLocationMode)}><option value="profile">Збігається з публічним місцем профілю</option><option value="pin">Обрати точку на мапі</option><option value="address">Обрати адресу вручну</option></select></label>
        {mode === 'profile' && <p className="listing-location-note">Використовується публічне місце з профілю. Адреса профілю не копіюється в оголошення й не відкривається через нього.</p>}
        {mode === 'pin' && <><p className="listing-location-note">Натисніть на мапу або перетягніть позначку до потрібного місця. Текст адреси не показуватиметься.</p><LocationPointPicker point={value.coordinates} onChange={setPoint} /></>}
        {mode === 'address' && <><p className="listing-location-note">Виберіть населений пункт, вулицю та номер будинку. Це окрема адреса лише для цього оголошення.</p><AddressInput value={{ ...value, mapLocationMode: 'address' }} onChange={(next) => change({ ...next, mapLocationMode: 'address' })} onBusyChange={setAddressBusy} name="address" /><label>Видимість цієї адреси<select value={visibility} onChange={(event) => change({ ...value, mapLocationMode: 'address', addressVisibility: event.target.value as 'private' | 'public', addressVisibilityConsent: event.target.value === 'private' ? false : value.addressVisibilityConsent })}><option value="private">Показувати точку без тексту адреси</option><option value="public">Показувати точну адресу й точку всім</option></select></label>{visibility === 'public' && <div className="field-error" role="status"><strong>Адреса стане публічною.</strong> Перевага: покупцям простіше знайти магазин або місце видачі. Ризик: будь-хто побачить адресу й зможе приїхати туди.<label className="consent-row"><input type="checkbox" checked={value.addressVisibilityConsent === true} onChange={(event) => change({ ...value, mapLocationMode: 'address', addressVisibilityConsent: event.target.checked })} />Розумію наслідки й погоджуюся показувати цю адресу всім.</label></div>}</>}
        <p className="listing-location-note" role="status">{busy ? 'Завантажуємо місце профілю…' : validCoordinates(value.coordinates) ? '✓ Точку для мапи визначено' : 'Оберіть місце для мапи.'}</p>
        {message && <p className="listing-location-note" role="status">{message}</p>}<FieldError message={error} />
    </fieldset>
}
