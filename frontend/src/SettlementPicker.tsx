import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { findSettlementRegions, findSettlements, findSettlementsInRegion, settlementLabel, type Settlement } from './settlement-model'
import './settlement-picker.css'

type Props = {
    value?: Settlement | null; legacyName?: string; onChange: (value: Settlement | null) => void; label?: string; disabled?: boolean
    allowNationwide?: boolean; onRegionChange?: (region: string | null) => void; allowClear?: boolean
}

export default function SettlementPicker({ value, legacyName = '', onChange, label = 'Населений пункт', disabled = false, allowNationwide = false, onRegionChange }: Props) {
    const [query, setQuery] = useState('')
    const [items, setItems] = useState<Settlement[]>([])
    const [regions, setRegions] = useState<string[]>([])
    const [open, setOpen] = useState(false)
    const [view, setView] = useState<'regions' | 'settlements' | 'search'>('regions')
    const [region, setRegion] = useState('')
    const [total, setTotal] = useState(0)
    const [pending, setPending] = useState(false)
    const [error, setError] = useState('')
    const [active, setActive] = useState(-1)
    const id = useId()
    const root = useRef<HTMLDivElement>(null)
    const version = useRef(0)
    const selectedLabel = value ? settlementLabel(value) : legacyName
    const displayLabel = selectedLabel || (allowNationwide ? 'Уся Україна' : '')
    const namesakeCounts = useMemo(() => {
        const counts = new Map<string, number>()
        for (const item of items) { const key = `${item.name}|${item.district}|${item.region}`; counts.set(key, (counts.get(key) ?? 0) + 1) }
        return counts
    }, [items])

    const close = () => { version.current++; setOpen(false); setQuery(''); setItems([]); setError(''); setActive(-1) }
    const showRegions = () => { if (!disabled) { setQuery(''); setItems([]); setError(''); setView('regions'); setOpen(true) } }
    const choose = (item: Settlement) => { version.current++; setOpen(false); setQuery(''); setItems([]); onRegionChange?.(null); onChange(item) }
    const chooseNationwide = () => { version.current++; setOpen(false); setQuery(''); setItems([]); onRegionChange?.(null); onChange(null) }
    const openRegion = (next: string) => { setRegion(next); setItems([]); setTotal(0); setError(''); setView('settlements'); setActive(-1) }

    useEffect(() => { version.current++; setQuery(''); setOpen(false); setItems([]) }, [selectedLabel, value?.code])
    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => { if (root.current && !root.current.contains(event.target as Node)) close() }
        document.addEventListener('mousedown', closeOnOutsideClick)
        return () => document.removeEventListener('mousedown', closeOnOutsideClick)
    }, [])
    useEffect(() => {
        if (!open) return
        const controller = new AbortController()
        const current = ++version.current
        setPending(true); setError(''); setActive(-1)
        const load = async () => {
            try {
                if (view === 'regions') {
                    const next = await findSettlementRegions(controller.signal)
                    if (current === version.current) setRegions(next)
                } else if (view === 'search') {
                    const next = await findSettlements(query, controller.signal)
                    if (current === version.current) { setItems(next); setTotal(next.length) }
                } else {
                    const next = await findSettlementsInRegion(region, 0, controller.signal)
                    if (current === version.current) { setItems(next.settlements); setTotal(next.total) }
                }
            } catch (reason) { if (!controller.signal.aborted && current === version.current) setError((reason as Error).message) }
            finally { if (current === version.current) setPending(false) }
        }
        const timer = view === 'search' ? window.setTimeout(load, 250) : undefined
        if (!timer) void load()
        return () => { if (timer) window.clearTimeout(timer); controller.abort() }
    }, [open, view, region, query])

    const loadMore = async () => {
        if (view !== 'settlements' || pending || items.length >= total) return
        setPending(true)
        try {
            const next = await findSettlementsInRegion(region, items.length)
            setItems(current => [...current, ...next.settlements]); setTotal(next.total)
        } catch (reason) { setError((reason as Error).message) }
        finally { setPending(false) }
    }
    const typeSearch = (next: string) => { setQuery(next); setItems([]); setView(next.trim().length >= 2 ? 'search' : 'regions'); setOpen(true) }
    const settlementButtons = items.map((item, index) => <button id={`${id}-${index}`} role="option" aria-selected={index === active} type="button" key={item.code} onMouseDown={event => event.preventDefault()} onClick={() => choose(item)}>
        {settlementLabel(item)}{(namesakeCounts.get(`${item.name}|${item.district}|${item.region}`) ?? 0) > 1 && <small>{item.community} громада</small>}
    </button>)

    return <div className="settlement-picker" ref={root}>
        <label htmlFor={id}>{label}</label>
        <div className="settlement-picker-field">
            <input id={id} role="combobox" aria-autocomplete="list" aria-expanded={open} aria-controls={`${id}-list`} aria-activedescendant={active >= 0 ? `${id}-${active}` : undefined} disabled={disabled} value={open ? query : displayLabel} autoComplete="off" maxLength={240} placeholder={allowNationwide ? 'Уся Україна' : 'Введіть назву та оберіть підказку'} onFocus={showRegions} onChange={event => typeSearch(event.target.value)} onKeyDown={event => {
                if (event.key === 'Escape') { event.stopPropagation(); close() }
                if ((event.key === 'ArrowDown' || event.key === 'ArrowUp') && view === 'search') { event.preventDefault(); setActive(current => Math.max(0, Math.min(items.length - 1, current + (event.key === 'ArrowDown' ? 1 : -1)))) }
                if (event.key === 'Enter' && open && view === 'search' && items[active]) { event.preventDefault(); choose(items[active]) }
            }} />
            <button type="button" className={`settlement-picker-toggle ${open ? 'is-open' : ''}`} onClick={() => open ? close() : showRegions()} aria-label={open ? 'Закрити список місць' : 'Відкрити список областей'} aria-expanded={open} disabled={disabled}><span aria-hidden="true" /></button>
        </div>
        {open && <div className="settlement-picker-results" id={`${id}-list`} role="listbox" onScroll={event => { const element = event.currentTarget; if (element.scrollTop + element.clientHeight >= element.scrollHeight - 30) void loadMore() }}>
            {view === 'regions' && <>
                {allowNationwide && <button type="button" className="settlement-picker-nationwide" role="option" onMouseDown={event => event.preventDefault()} onClick={chooseNationwide}>⌖ <span>Уся Україна</span></button>}
                <strong>Оберіть область</strong>
                {regions.map(item => <button type="button" role="option" key={item} onMouseDown={event => event.preventDefault()} onClick={() => openRegion(item)}>{item}<b aria-hidden="true">›</b></button>)}
            </>}
            {view === 'settlements' && <>
                <button type="button" className="settlement-picker-back" onMouseDown={event => event.preventDefault()} onClick={showRegions}>‹ Назад</button>
                <div className="settlement-picker-region-title"><strong>{region}</strong><button type="button" onMouseDown={event => event.preventDefault()} onClick={() => { onChange(null); onRegionChange?.(region); close() }}>Вся область</button></div>
                <strong>Оберіть населений пункт</strong>{settlementButtons}
            </>}
            {view === 'search' && <>{settlementButtons}{!items.length && <span role="status">{error || (pending ? 'Шукаємо…' : 'Населених пунктів не знайдено.')}</span>}</>}
            {pending && view !== 'search' && <span role="status">Завантаження…</span>}
        </div>}
    </div>
}
