import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { findSettlements, settlementLabel, type Settlement } from './settlement-model'
import './settlement-picker.css'

export default function SettlementPicker({ value, legacyName = '', onChange, label = 'Населений пункт', disabled = false, allowClear = false }: {
    value?: Settlement | null; legacyName?: string; onChange: (value: Settlement | null) => void; label?: string; disabled?: boolean; allowClear?: boolean
}) {
    const [query, setQuery] = useState(value ? settlementLabel(value) : legacyName)
    const [items, setItems] = useState<Settlement[]>([])
    const [open, setOpen] = useState(false)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    const [active, setActive] = useState(-1)
    const id = useId()
    const version = useRef(0)
    const selectedLabel = value ? settlementLabel(value) : legacyName
    const namesakeCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const item of items) { const key = `${item.name}|${item.district}|${item.region}`; counts.set(key, (counts.get(key) ?? 0) + 1) }
        return counts
    }, [items])
    useEffect(() => { version.current++; setQuery(selectedLabel); setOpen(false); setItems([]) }, [selectedLabel, value?.code])
    useEffect(() => {
        if (!open || query.trim().length < 2 || query === selectedLabel && value) { setItems([]); setPending(false); return }
        const controller = new AbortController()
        const current = ++version.current
        setPending(true); setError(''); setItems([]); setActive(-1)
        const timer = window.setTimeout(() => {
            findSettlements(query, controller.signal).then(items => { if (current === version.current) setItems(items) })
                .catch(error => { if (!controller.signal.aborted && current === version.current) setError(error.message) })
                .finally(() => { if (current === version.current) setPending(false) })
        }, 250)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [query, open, selectedLabel, value?.code])
    const choose = (item: Settlement) => { version.current++; setQuery(settlementLabel(item)); setOpen(false); setItems([]); onChange(item) }
    return <div className="settlement-picker">
        <label htmlFor={id}>{label}</label>
        <div className="settlement-picker-field"><input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined}
            disabled={disabled} value={query} autoComplete="off" maxLength={240} placeholder="Введіть назву та оберіть підказку"
            onFocus={() => setOpen(true)} onBlur={() => { version.current++; setOpen(false); setQuery(selectedLabel); setError('') }}
            onChange={event => { version.current++; setQuery(event.target.value); setItems([]); setOpen(true) }}
            onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); setOpen(false); setQuery(selectedLabel) }
                if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); setOpen(true); setActive(current => Math.max(0, Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))) }
                if (event.key === 'Enter') { event.preventDefault(); if (open && items[active]) choose(items[active]) }
            }} />
            {allowClear && <button type="button" className="outline-button compact" disabled={disabled} onClick={() => { version.current++; onChange(null); setQuery(''); setOpen(false) }} aria-label="Очистити населений пункт">×</button>}
        </div>
        {open && <div className="settlement-picker-results" id={`${id}-list`} role="listbox">
            {items.map((item, index) => <button id={`${id}-${index}`} role="option" aria-selected={index === active} type="button" key={item.code} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
                {settlementLabel(item)}{(namesakeCounts.get(`${item.name}|${item.district}|${item.region}`) ?? 0) > 1 && <small>{item.community} громада</small>}
            </button>)}
            {!items.length && <span role="status">{error || (pending ? 'Шукаємо…' : query.trim().length < 2 ? 'Введіть щонайменше дві літери.' : query === selectedLabel && value ? 'Змініть назву для нового пошуку.' : 'Населених пунктів не знайдено.')}</span>}
        </div>}
    </div>
}
