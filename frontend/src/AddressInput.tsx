import { useEffect, useRef, useState } from 'react'
import { validCoordinates, type AddressValue, type Coordinates } from './address-model'
import SettlementPicker from './SettlementPicker'
import { findSettlements, hereRequest, matchesSettlement, matchesStreet, normalizePlace, resolveSettlement, savedAddressParts, searchStreets, settlementLabel, type HereItem, type SelectedSettlement, type Settlement } from './settlement-model'
import './listing-ui.css'

type Props = { initialValue?: string; value?: AddressValue; onChange?: (value: AddressValue) => void; onBusyChange?: (busy: boolean) => void; name?: string; requireStreet?: boolean; openRequest?: number }
export default function AddressInput({ initialValue = '', value, onChange, onBusyChange, name = 'exactAddress', requireStreet = true, openRequest = 0 }: Props) {
    const [saved, setSaved] = useState(initialValue)
    const [open, setOpen] = useState(false)
    const [selected, setSelected] = useState<SelectedSettlement | null>(null)
    const [street, setStreet] = useState('')
    const [house, setHouse] = useState('')
    const [streetChosen, setStreetChosen] = useState(false)
    const [streetResults, setStreetResults] = useState<HereItem[]>([])
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [unconfirmed, setUnconfirmed] = useState(false)
    const editButton = useRef<HTMLButtonElement>(null)
    const popup = useRef<HTMLDivElement>(null)
    const operation = useRef(0)
    const committed = value ? value.address || value.city : saved
    useEffect(() => setSaved(initialValue), [initialValue])
    useEffect(() => { onBusyChange?.(busy); return () => onBusyChange?.(false) }, [busy, onBusyChange])
    useEffect(() => () => { operation.current++ }, [])
    const close = () => { operation.current++; setOpen(false); setBusy(false); editButton.current?.focus() }
    useEffect(() => {
        if (!open) return
        popup.current?.querySelector<HTMLInputElement>('[role="combobox"]')?.focus()
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { event.stopPropagation(); close() } }
        window.addEventListener('keydown', escape)
        return () => window.removeEventListener('keydown', escape)
    }, [open])
    useEffect(() => {
        if (!open || !selected || streetChosen || !street.trim()) { setStreetResults([]); return }
        const controller = new AbortController()
        setStreetResults([])
        const timer = window.setTimeout(async () => {
            try {
                const items = await searchStreets(selected, street, controller.signal)
                if (!controller.signal.aborted) {
                    setStreetResults(items)
                    setError(items.length ? '' : 'Вулиць не знайдено. Введіть ще кілька літер або змініть початок назви.')
                }
            } catch { if (!controller.signal.aborted) setError('Підказки вулиць недоступні. Вулицю можна ввести вручну.') }
        }, 300)
        return () => { clearTimeout(timer); controller.abort() }
    }, [open, selected, street, streetChosen])
    const begin = () => {
        operation.current++
        const parts = savedAddressParts(value?.address || '', value?.settlement)
        setSelected(value?.settlement ?? null)
        setStreet(parts.street); setHouse(parts.house)
        setStreetChosen(false); setStreetResults([]); setError(''); setUnconfirmed(false); setOpen(true)
        if (value?.settlement && !value.settlement.hereId) {
            const current = operation.current
            setBusy(true)
            resolveSettlement(value.settlement).then(resolved => { if (current === operation.current) setSelected(resolved) })
                .catch(error => { if (current === operation.current) setError(error.message) })
                .finally(() => { if (current === operation.current) setBusy(false) })
        }
    }
    const choose = async (item: Settlement | null) => {
        const current = ++operation.current
        setSelected(item); setStreet(''); setHouse(''); setStreetChosen(false); setStreetResults([]); setError(''); setUnconfirmed(false)
        if (!item) return
        setBusy(true)
        try { const resolved = await resolveSettlement(item); if (current === operation.current) setSelected(resolved) }
        catch (error) { if (current === operation.current) setError((error as Error).message) }
        finally { if (current === operation.current) setBusy(false) }
    }
    useEffect(() => { if (openRequest) begin() }, [openRequest])
    const saveAddress = (coordinates: Coordinates | null) => {
        if (!selected || (requireStreet && (!street.trim() || !house.trim()))) return
        const address = street.trim() ? [selected.name, street.trim(), house.trim(), selected.district, selected.region].filter(Boolean).join(', ') : ''
        const next: AddressValue = { address, city: selected.name, settlement: selected, coordinates: validCoordinates(coordinates) ? coordinates : null, addressVisibility: value?.addressVisibility ?? 'private', addressVisibilityConsent: value?.addressVisibilityConsent ?? false }
        setSaved(address || selected.name); onChange?.(next); close()
    }
    const apply = async () => {
        if (!selected || busy || (requireStreet && (!street.trim() || !house.trim()))) return
        const current = ++operation.current
        setBusy(true); setError(''); setStreetResults([])
        const address = [selected.name, street.trim(), house.trim(), selected.district, selected.region].filter(Boolean).join(', ')
        let coordinates: Coordinates | null = !street.trim() ? selected.coordinates ?? null : address === value?.address ? value.coordinates : null
        if (street.trim()) {
            try {
                if (!selected.hereId) {
                    const siblings = await findSettlements(selected.name)
                    if (siblings.some(other => other.code !== selected.code && normalizePlace(other.name) === normalizePlace(selected.name) && other.region === selected.region && (other.district === selected.district || selected.type === 'city'))) throw new Error('HERE не розрізняє ці однойменні пункти. Адресу можна зберегти без автоматичної точки та вказати координати вручну.')
                }
                const hereAddress = [selected.name, street.trim(), house.trim(), selected.type === 'city' ? '' : selected.hereDistrict || selected.district, selected.region].filter(Boolean).join(', ')
                const parameters: Record<string, string> = { q: hereAddress, in: 'countryCode:UKR', limit: '20' }
                if (selected.coordinates) parameters.at = `${selected.coordinates.latitude},${selected.coordinates.longitude}`
                const items = await hereRequest('geocode', parameters)
                const matches = items.filter(item => item.position && matchesSettlement(item, selected) && matchesStreet(item.address?.street, street) && (house.trim() ? item.resultType === 'houseNumber' && item.address?.houseNumber?.toLocaleLowerCase('uk-UA') === house.trim().toLocaleLowerCase('uk-UA') : item.resultType === 'street'))
                if (matches.length === 1) coordinates = { latitude: matches[0].position!.lat, longitude: matches[0].position!.lng }
                else if (!coordinates) throw new Error('HERE не підтвердив цю адресу у вибраному населеному пункті. Перевірте вулицю та будинок.')
            } catch (error) {
                if (current === operation.current) { setError((error as Error).message); setUnconfirmed(true); setBusy(false) }
                return
            }
        }
        if (current !== operation.current) return
        saveAddress(coordinates)
    }
    return <div className="address-editor"><input type="hidden" name={name} value={value?.address ?? saved} />
        <div className="address-display"><input value={committed} readOnly placeholder="Оберіть населений пункт та адресу" aria-label="Обрана адреса" /><button ref={editButton} type="button" className="outline-button compact" onClick={begin}>{committed ? 'Змінити адресу' : 'Обрати адресу'}</button></div>
        {open && <div className="address-dialog-backdrop" onMouseDown={close}><div ref={popup} className="address-popup" role="dialog" aria-modal="true" aria-label="Вибір адреси" onMouseDown={event => event.stopPropagation()}>
            <button type="button" className="modal-close" aria-label="Закрити адресу" onClick={close}>×</button><strong>Вибір адреси</strong>
            <p>{requireStreet ? 'Оберіть населений пункт, вулицю та будинок.' : 'Оберіть населений пункт. Вулиця й будинок допоможуть точніше визначити місце на мапі.'}</p>
            <SettlementPicker value={selected} legacyName={value?.city ?? ''} onChange={choose} disabled={busy} />
            <div className="address-street-row"><label>Вулиця<input value={street} disabled={busy || !selected} maxLength={200} autoComplete="off" placeholder="Назва вулиці" onKeyDown={event => { if (event.key === 'Enter') event.preventDefault() }} onChange={event => { operation.current++; setStreet(event.target.value); setHouse(''); setStreetChosen(false); setStreetResults([]); setError('') }} />
                {streetResults.length > 0 && <div className="address-results">{streetResults.map(item => <button type="button" key={item.id} onClick={() => { setStreet(item.address?.street || item.title); setStreetChosen(true); setStreetResults([]) }}><b>{item.address?.street || item.title}</b><small>{selected && settlementLabel(selected)}</small></button>)}</div>}
            </label><label>Будинок<input value={house} disabled={busy || !selected || !street.trim()} maxLength={40} placeholder="12-А" onKeyDown={event => { if (event.key === 'Enter') { event.preventDefault(); void apply() } }} onChange={event => setHouse(event.target.value)} /></label></div>
            {error && <span className="field-error" role="status">{error}</span>}
            {unconfirmed && !busy && selected && <button type="button" className="outline-button" onClick={() => saveAddress(null)}>Зберегти адресу без координат</button>}
            <div className="address-dialog-actions"><button type="button" className="outline-button" onClick={close}>Скасувати</button><button type="button" className="primary-button" disabled={busy || !selected || (requireStreet && (!street.trim() || !house.trim()))} onClick={apply}>{busy ? 'Визначаємо місце…' : 'Застосувати'}</button></div>
        </div></div>}
    </div>
}
