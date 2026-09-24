import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { categoryChildren, categoryLabels } from './categories'
import type { Category } from './categories'
import './categories.css'

export function CategoryImage({ category, className = '' }: { category: Category; className?: string }) {
    const index = Math.max(0, Math.min(19, category.imageIndex ?? 18))
    return <span className={`category-image ${className}`} aria-hidden="true" style={{ backgroundPosition: `${(index % 5) * 25}% ${Math.floor(index / 5) * (100 / 3)}%` }} />
}

type Props = { categories: Category[]; value?: string; defaultValue?: string; onChange?: (id: string) => void; name?: string; required?: boolean; allowAll?: boolean; className?: string }

export default function CategoryPicker({ categories, value, defaultValue = '', onChange, name = 'categoryId', required = false, allowAll = false, className = '' }: Props) {
    const [localValue, setLocalValue] = useState(defaultValue)
    const [query, setQuery] = useState('')
    const [open, setOpen] = useState(false)
    const [hoveredIds, setHoveredIds] = useState<string[]>([])
    const root = useRef<HTMLDivElement>(null)
    const input = useRef<HTMLInputElement>(null)
    const id = useId()
    const selectedId = value ?? localValue
    const labels = useMemo(() => categoryLabels(categories), [categories])
    const selectedLabel = labels.get(selectedId) ?? ''
    const normalized = query.trim().toLocaleLowerCase('uk-UA')
    const rootCategories = useMemo(() => categoryChildren(categories, null), [categories])
    const matchingCategories = useMemo(() => normalized ? categories.filter((item) => labels.get(item.id)?.toLocaleLowerCase('uk-UA').includes(normalized)) : rootCategories, [categories, labels, normalized, rootCategories])

    useEffect(() => {
        const closeOnOutsideClick = (event: MouseEvent) => {
            if (root.current && !root.current.contains(event.target as Node)) close()
        }
        document.addEventListener('mousedown', closeOnOutsideClick)
        return () => document.removeEventListener('mousedown', closeOnOutsideClick)
    }, [])

    const close = () => { setOpen(false); setQuery(''); setHoveredIds([]) }
    const choose = (next: string) => { setLocalValue(next); close(); onChange?.(next) }
    const showMenu = () => { if (categories.length) { setOpen(true); setHoveredIds([]) } }
    const setHover = (categoryId: string, level: number) => setHoveredIds((current) => [...current.slice(0, level), categoryId])
    const submenus = hoveredIds.reduce<Category[][]>((items, parentId) => {
        const children = categoryChildren(categories, parentId)
        return children.length ? [...items, children] : items
    }, [])
    const label = (item: Category) => normalized ? labels.get(item.id) ?? item.name : item.name
    const list = (items: Category[], level: number, flyout = false) => <div className={flyout ? 'category-picker-submenu' : 'category-picker-results'} role="listbox" aria-label={flyout ? 'Підкатегорії' : normalized ? 'Знайдені категорії' : 'Усі категорії'}>
        {!flyout && allowAll && !normalized && <button type="button" role="option" aria-selected={!selectedId} className="category-picker-all" onMouseDown={(event) => event.preventDefault()} onClick={() => choose('')}>Усі категорії</button>}
        {items.map((item) => {
            const hasChildren = categoryChildren(categories, item.id).length > 0
            return <button type="button" role="option" aria-selected={item.id === selectedId} key={item.id} className={hoveredIds[level] === item.id ? 'is-hovered' : ''} onMouseEnter={() => setHover(item.id, level)} onFocus={() => setHover(item.id, level)} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(item.id)}><span>{label(item)}</span>{hasChildren && <b aria-label="Має підкатегорії">›</b>}</button>
        })}
    </div>

    return <div className={`category-picker ${className}`} ref={root}>
        <input type="hidden" name={name} value={selectedId} />
        <div className="category-picker-control">
            <input ref={input} id={`${id}-search`} type="text" role="combobox" autoComplete="off" value={open ? query : selectedLabel} onFocus={showMenu} onChange={(event) => { setQuery(event.target.value); setOpen(true); setHoveredIds([]) }} onKeyDown={(event) => { if (event.key === 'Escape') { close(); input.current?.blur() }; if (event.key === 'ArrowDown') showMenu(); if (event.key === 'Enter' && normalized && matchingCategories.length === 1) { event.preventDefault(); choose(matchingCategories[0].id) } }} placeholder="Введіть або оберіть категорію" aria-label="Пошук або вибір категорії" aria-expanded={open} aria-controls={`${id}-menu`} required={required} disabled={!categories.length} />
            <button type="button" className={`category-picker-toggle ${open ? 'is-open' : ''}`} onClick={() => open ? close() : (showMenu(), input.current?.focus())} aria-label={open ? 'Закрити список категорій' : 'Відкрити список категорій'} aria-expanded={open} disabled={!categories.length}><span aria-hidden="true" /></button>
        </div>
        {open && <div id={`${id}-menu`} className="category-picker-menu">
            {matchingCategories.length ? list(matchingCategories, 0) : <p className="category-picker-empty">Категорій не знайдено</p>}
            {submenus.map((items, level) => <div className="category-picker-flyout" key={hoveredIds[level]} style={{ left: `calc(100% + ${8 + level * 264}px)` }}>{list(items, level + 1, true)}</div>)}
        </div>}
        {!categories.length && <small role="status">Список категорій завантажується або недоступний.</small>}
    </div>
}
