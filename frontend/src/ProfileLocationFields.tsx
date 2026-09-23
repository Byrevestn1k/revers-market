import { useState, type ReactNode } from 'react'
import AddressInput from './AddressInput'
import LocationPointPicker from './LocationPointPicker'
import type { SelectedSettlement } from './settlement-model'
import { validCoordinates, type AddressValue, type Coordinates } from './address-model'

export type ProfileMapLocation = { mode: 'approximate' | 'address' | 'pin'; latitude: number | null; longitude: number | null; consent?: boolean }
type LocationProfile = { exactAddress: string | null; location: string | null; mapLocation?: ProfileMapLocation; settlement?: SelectedSettlement | null; addressSettlement?: SelectedSettlement | null; addressCoordinates?: Coordinates | null }
const samePoint = (left: Coordinates | null, right: Coordinates | null) => Boolean(left && right && Math.abs(left.latitude - right.latitude) < .000001 && Math.abs(left.longitude - right.longitude) < .000001)

function LocationHint({ children }: { children: ReactNode }) {
    return <span className="location-hint" tabIndex={0} aria-label="Пояснення"><span className="location-hint-badge" aria-hidden="true">i</span><span className="location-hint-popup" role="tooltip">{children}</span></span>
}

export default function ProfileLocationFields({ profile, onChange, onBusyChange }: { profile: LocationProfile; onChange: (patch: Partial<LocationProfile>) => void; onBusyChange: (busy: boolean) => void }) {
    const setting = profile.mapLocation ?? { mode: 'approximate', latitude: null, longitude: null }
    const candidate = setting.latitude !== null && setting.longitude !== null ? { latitude: setting.latitude, longitude: setting.longitude } : null
    const point = validCoordinates(candidate) ? candidate : null
    const [addressPoint, setAddressPoint] = useState<Coordinates | null>(profile.addressCoordinates ?? (setting.mode === 'address' ? point : null))
    const [pinSource, setPinSource] = useState<'profile' | 'map' | 'manual'>(() => samePoint(point, profile.addressCoordinates ?? null) ? 'profile' : 'map')
    const [manualPointAddress, setManualPointAddress] = useState<AddressValue>(() => ({ address: '', city: profile.settlement?.name ?? profile.location ?? '', settlement: profile.settlement, coordinates: point }))
    const updatePoint = (next: Coordinates) => onChange({ mapLocation: { ...setting, ...next, consent: false } })
    return <fieldset className="listing-section"><legend>Моє місце на мапі</legend>
        <div className="location-field-label">Адреса профілю <LocationHint><strong>Адреса профілю</strong> — ваша приватна адреса. Вона допомагає визначити ваше місце для пошуку «поруч», підставити адресу під час створення оголошення та вибрати публічну точку. Іншим вона не показується, якщо ви окремо не обрали її публічність.</LocationHint></div>
        <AddressInput name="exactAddress" value={{ address: profile.exactAddress ?? '', city: profile.addressSettlement?.name ?? profile.location ?? '', settlement: profile.addressSettlement, coordinates: addressPoint }} onBusyChange={onBusyChange} onChange={(value) => {
            setAddressPoint(value.coordinates)
            const useAddressPoint = setting.mode === 'address' || (setting.mode === 'pin' && pinSource === 'profile')
            onChange({ exactAddress: value.address, addressSettlement: value.settlement, addressCoordinates: value.coordinates, ...(useAddressPoint ? { location: value.city, settlement: value.settlement, mapLocation: { ...setting, latitude: value.coordinates?.latitude ?? null, longitude: value.coordinates?.longitude ?? null, consent: false } } : {}) })
        }} />
        <label>Як показувати мої товари чи запити<select value={setting.mode} onChange={(event) => {
            const mode = event.target.value as ProfileMapLocation['mode']
            const next = mode === 'address' ? addressPoint : mode === 'pin' ? point ?? addressPoint : null
            if (mode === 'pin') setPinSource(addressPoint && (!point || samePoint(point, addressPoint)) ? 'profile' : 'map')
            onChange({ mapLocation: { mode, latitude: next?.latitude ?? null, longitude: next?.longitude ?? null, consent: false }, ...(mode === 'address' && profile.addressSettlement ? { location: profile.addressSettlement.name, settlement: profile.addressSettlement } : {}) })
        }}><option value="approximate">Приблизне місце — точна адреса прихована</option><option value="address">Показувати точну адресу профілю</option><option value="pin">Власна публічна точка на мапі</option></select></label>
        <p className="listing-location-note">Налаштування діє для всіх ваших товарів та запитів на покупку. Адреси отримання товарів та місця запитів покупця не змінюються.</p>
        {setting.mode === 'address' && <div className="field-error" role="status"><strong>Адреса стане публічною.</strong> Перевага: покупцям легше знайти офіційний магазин або постійне місце видачі. Ризик: будь-хто побачить адресу, зможе приїхати туди та пов’язати її з вашим профілем. Якщо точку ще не визначено, повторно оберіть адресу вище.</div>}
        {setting.mode === 'pin' && <>
            <label><span className="location-field-label">Публічна точка <LocationHint><strong>Публічна точка</strong> — місце, яке бачать інші на мапі біля ваших товарів. Це може бути магазин, пункт видачі або зручне місце зустрічі. Вона не зобов’язана збігатися з адресою профілю.</LocationHint></span><select value={pinSource} onChange={(event) => {
                const source = event.target.value as 'profile' | 'map' | 'manual'
                setPinSource(source)
                if (source === 'profile') onChange({ mapLocation: { ...setting, latitude: addressPoint?.latitude ?? null, longitude: addressPoint?.longitude ?? null, consent: false }, ...(profile.addressSettlement ? { location: profile.addressSettlement.name, settlement: profile.addressSettlement } : {}) })
            }}><option value="profile">Збігається з адресою профілю</option><option value="map">Обрати точку на мапі</option><option value="manual">Обрати адресу вручну</option></select></label>
            {pinSource === 'profile' ? <p className="listing-location-note">Публічна точка буде там, де вибрана адреса профілю. Щоб змінити її, оберіть іншу адресу вище.</p> : pinSource === 'map' ? <><p className="listing-location-note">Натисніть на мапу або перетягніть позначку до потрібного місця. Текст адреси профілю залишиться прихованим.</p><LocationPointPicker point={point} onChange={updatePoint} /></> : <><p className="listing-location-note">Виберіть населений пункт, вулицю та номер будинку. Адреса потрібна лише для встановлення публічної точки: вона не замінить адресу профілю й не буде показана текстом.</p><AddressInput name="publicPointAddress" value={manualPointAddress} onBusyChange={onBusyChange} onChange={(value) => { setManualPointAddress(value); if (validCoordinates(value.coordinates)) onChange({ mapLocation: { ...setting, latitude: value.coordinates.latitude, longitude: value.coordinates.longitude, consent: false }, location: value.city, settlement: value.settlement }) }} /></>}
        </>}
        {setting.mode === 'pin' && <div className="field-error" role="status"><strong>Обрана точка стане публічною.</strong> Перевага: можна показати зручне місце зустрічі без тексту адреси. Ризик: люди бачитимуть це місце на карті та можуть приїхати туди.</div>}
        {setting.mode !== 'approximate' && <>
            <p role="status">{validCoordinates(point) ? '✓ Публічну точку визначено' : 'Оберіть точку перед збереженням'}</p>
            <label className="consent-row"><input type="checkbox" checked={setting.consent === true} onChange={(event) => onChange({ mapLocation: { ...setting, consent: event.target.checked } })} />Погоджуюся показувати всім {setting.mode === 'address' ? 'цю точну адресу та її місце' : 'обрану точку'}</label>
        </>}
        <p className="listing-location-note">Зміни набудуть чинності після натискання «Зберегти профіль». Щоб приховати місце, оберіть приблизне розташування та збережіть.</p>
    </fieldset>
}
