import { useEffect, useRef, useState } from 'react'
import type { HomeCity } from './search-location-model'
import SettlementPicker from './SettlementPicker'
import { resolveSettlement, type Settlement } from './settlement-model'

export default function SettlementSearchInput({ value, onChange }: { value: HomeCity | null; onChange: (value: HomeCity | null) => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const operation = useRef(0)
    useEffect(() => () => { operation.current++ }, [])
    const choose = async (item: Settlement | null) => {
        const current = ++operation.current
        setError('')
        if (!item) { setBusy(false); onChange(null); return }
        setBusy(true)
        try {
            const selected = await resolveSettlement(item)
            if (current === operation.current && selected.coordinates) onChange({ name: selected.name, ...selected.coordinates, settlement: selected })
        } catch (error) { if (current === operation.current) setError((error as Error).message) }
        finally { if (current === operation.current) setBusy(false) }
    }
    return <div className="map-search-mode map-settlement-search"><SettlementPicker value={value?.settlement} legacyName={value?.name} onChange={choose} disabled={busy} allowClear />{(busy || error) && <small role="status">{busy ? 'Узгоджуємо місце з HERE…' : error}</small>}</div>
}
