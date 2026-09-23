import { useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import AddressInput from './AddressInput'
import SettlementPicker from './SettlementPicker'
import type { SelectedSettlement } from './settlement-model'
import { validCoordinates, type Coordinates } from './address-model'

export type ProfileMapLocation = { mode: 'approximate' | 'address' | 'pin'; latitude: number | null; longitude: number | null; consent?: boolean }
type LocationProfile = { exactAddress: string | null; location: string | null; mapLocation?: ProfileMapLocation; settlement?: SelectedSettlement | null; addressSettlement?: SelectedSettlement | null; addressCoordinates?: Coordinates | null }
const samePoint = (left: Coordinates | null, right: Coordinates | null) => Boolean(left && right && Math.abs(left.latitude - right.latitude) < .000001 && Math.abs(left.longitude - right.longitude) < .000001)

function PointPicker({ point, onChange }: { point: Coordinates | null; onChange: (point: Coordinates) => void }) {
    const container = useRef<HTMLDivElement>(null)
    const map = useRef<L.Map | null>(null)
    const marker = useRef<L.Marker | null>(null)
    const callback = useRef(onChange)
    callback.current = onChange
    useEffect(() => {
        if (!container.current) return
        const instance = L.map(container.current, { scrollWheelZoom: false }).setView(point ? [point.latitude, point.longitude] : [50.6199, 26.2516], point ? 16 : 12)
        map.current = instance
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(instance)
        instance.on('click', (event: L.LeafletMouseEvent) => callback.current({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.wrap().lng.toFixed(6)) }))
        const resize = new ResizeObserver(() => instance.invalidateSize())
        resize.observe(container.current)
        return () => { resize.disconnect(); instance.remove(); map.current = null; marker.current = null }
    }, [])
    useEffect(() => {
        if (!map.current) return
        if (marker.current) { marker.current.remove(); marker.current = null }
        if (!point) return
        const position: L.LatLngExpression = [point.latitude, point.longitude]
        const pin = L.marker(position, { draggable: true, icon: L.divIcon({ className: 'profile-public-pin', html: '<span aria-hidden="true">●</span>', iconSize: [32, 32], iconAnchor: [16, 16] }) }).addTo(map.current)
        pin.on('dragend', () => { const next = pin.getLatLng().wrap(); callback.current({ latitude: Number(next.lat.toFixed(6)), longitude: Number(next.lng.toFixed(6)) }) })
        marker.current = pin
        map.current.panTo(position)
    }, [point?.latitude, point?.longitude])
    return <div ref={container} className="profile-point-picker" role="region" aria-label="Оберіть публічну точку натисканням на мапі" />
}

export default function ProfileLocationFields({ profile, onChange, onBusyChange }: { profile: LocationProfile; onChange: (patch: Partial<LocationProfile>) => void; onBusyChange: (busy: boolean) => void }) {
    const setting = profile.mapLocation ?? { mode: 'approximate', latitude: null, longitude: null }
    const candidate = setting.latitude !== null && setting.longitude !== null ? { latitude: setting.latitude, longitude: setting.longitude } : null
    const point = validCoordinates(candidate) ? candidate : null
    const [addressPoint, setAddressPoint] = useState<Coordinates | null>(profile.addressCoordinates ?? (setting.mode === 'address' ? point : null))
    const [pinSource, setPinSource] = useState<'profile' | 'map'>(() => samePoint(point, profile.addressCoordinates ?? null) ? 'profile' : 'map')
    const updatePoint = (next: Coordinates) => onChange({ mapLocation: { ...setting, ...next, consent: false } })
    return <fieldset className="listing-section"><legend>Моє місце на мапі</legend>
        <label>Адреса профілю</label>
        <AddressInput name="exactAddress" value={{ address: profile.exactAddress ?? '', city: profile.addressSettlement?.name ?? profile.location ?? '', settlement: profile.addressSettlement, coordinates: addressPoint }} onBusyChange={onBusyChange} onChange={(value) => {
            setAddressPoint(value.coordinates)
            const useAddressPoint = setting.mode === 'address' || (setting.mode === 'pin' && pinSource === 'profile')
            onChange({ exactAddress: value.address, addressSettlement: value.settlement, addressCoordinates: value.coordinates, ...(useAddressPoint ? { location: value.city, settlement: value.settlement, mapLocation: { ...setting, latitude: value.coordinates?.latitude ?? null, longitude: value.coordinates?.longitude ?? null, consent: false } } : {}) })
        }} />
        <label>Як показувати мої товари<select value={setting.mode} onChange={(event) => {
            const mode = event.target.value as ProfileMapLocation['mode']
            const next = mode === 'address' ? addressPoint : mode === 'pin' ? point ?? addressPoint : null
            if (mode === 'pin') setPinSource(addressPoint && (!point || samePoint(point, addressPoint)) ? 'profile' : 'map')
            onChange({ mapLocation: { mode, latitude: next?.latitude ?? null, longitude: next?.longitude ?? null, consent: false }, ...(mode === 'address' && profile.addressSettlement ? { location: profile.addressSettlement.name, settlement: profile.addressSettlement } : {}) })
        }}><option value="approximate">Приблизне місце — точна адреса прихована</option><option value="address">Показувати точну адресу профілю</option><option value="pin">Власна публічна точка на мапі</option></select></label>
        <p className="listing-location-note">Налаштування діє для всіх ваших товарів. Адреси отримання товарів та місця запитів покупця не змінюються.</p>
        {setting.mode === 'address' && <div className="field-error" role="status"><strong>Адреса стане публічною.</strong> Перевага: покупцям легше знайти офіційний магазин або постійне місце видачі. Ризик: будь-хто побачить адресу, зможе приїхати туди та пов’язати її з вашим профілем. Якщо точку ще не визначено, повторно оберіть адресу вище.</div>}
        {setting.mode === 'pin' && <>
            <label>Публічна точка<select value={pinSource} onChange={(event) => {
                const source = event.target.value as 'profile' | 'map'
                setPinSource(source)
                if (source === 'profile') onChange({ mapLocation: { ...setting, latitude: addressPoint?.latitude ?? null, longitude: addressPoint?.longitude ?? null, consent: false }, ...(profile.addressSettlement ? { location: profile.addressSettlement.name, settlement: profile.addressSettlement } : {}) })
            }}><option value="profile">Збігається з адресою профілю</option><option value="map">Обрати точку на мапі</option></select></label>
            {pinSource === 'profile' ? <p className="listing-location-note">Публічна точка буде там, де вибрана адреса профілю. Щоб змінити її, оберіть іншу адресу вище.</p> : <><p className="listing-location-note">Натисніть на мапу або перетягніть точку до потрібного місця. Текст адреси профілю залишиться прихованим.</p><PointPicker point={point} onChange={updatePoint} /><SettlementPicker label="Населений пункт публічної точки" value={profile.settlement} legacyName={profile.location ?? ''} onChange={item => onChange({ location: item?.name ?? '', settlement: item })} /></>}
        </>}
        {setting.mode === 'pin' && <div className="field-error" role="status"><strong>Обрана точка стане публічною.</strong> Перевага: можна показати зручне місце зустрічі без тексту адреси. Ризик: люди бачитимуть це місце на карті та можуть приїхати туди.</div>}
        {setting.mode !== 'approximate' && <>
            <p role="status">{validCoordinates(point) ? '✓ Публічну точку визначено' : 'Оберіть точку перед збереженням'}</p>
            <label className="consent-row"><input type="checkbox" checked={setting.consent === true} onChange={(event) => onChange({ mapLocation: { ...setting, consent: event.target.checked } })} />Погоджуюся показувати всім {setting.mode === 'address' ? 'цю точну адресу та її місце' : 'обрану точку'}</label>
        </>}
        <p className="listing-location-note">Зміни набудуть чинності після натискання «Зберегти профіль». Щоб приховати місце, оберіть приблизне розташування та збережіть.</p>
    </fieldset>
}
