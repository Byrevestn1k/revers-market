import { useEffect, useRef, useState } from 'react'
import type { HomeCity } from './search-location-model'
import SettlementPicker from './SettlementPicker'
import { resolveSettlement, type Settlement } from './settlement-model'

export default function SettlementSearchInput({ value, onChange, onRegionChange }: { value: HomeCity | null; onChange: (value: HomeCity | null) => void; onRegionChange?: (region: string | null) => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [regionName, setRegionName] = useState('')
    const operation = useRef(0)
    useEffect(() => () => { operation.current++ }, [])
    const choose = async (item: Settlement | null) => {
        const current = ++operation.current
        setError('')
        if (!item) { setBusy(false); onChange(null); return }
        setRegionName('')
        setBusy(true)
        try {
            const selected = await resolveSettlement(item)
            if (current === operation.current && selected.coordinates) onChange({ name: selected.name, ...selected.coordinates, settlement: selected })
        } catch (error) { if (current === operation.current) setError((error as Error).message) }
        finally { if (current === operation.current) setBusy(false) }
    }
    const changeRegion = (region: string | null) => { setRegionName(region ?? ''); onRegionChange?.(region) }
    return <div className="map-search-mode map-settlement-search"><SettlementPicker value={value?.settlement} legacyName={value?.name ?? regionName} onChange={choose} onRegionChange={changeRegion} disabled={busy} allowNationwide />{(busy || error) && <small role="status">{busy ? 'Узгоджуємо місце з HERE…' : error}</small>}</div>
}
