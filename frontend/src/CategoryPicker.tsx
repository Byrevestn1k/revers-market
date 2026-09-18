import { useId, useMemo, useState } from 'react'
import { categoryChildren, categoryLabels, categoryTrail } from './categories'
import type { Category } from './categories'
import './categories.css'

export function CategoryImage({ category, className = '' }: { category: Category; className?: string }) {
    const index = Math.max(0, Math.min(19, category.imageIndex ?? 18))
    return <span className={`category-image ${className}`} aria-hidden="true" style={{ backgroundPosition: `${(index % 5) * 25}% ${Math.floor(index / 5) * (100 / 3)}%` }} />
}

type Props = {
    categories: Category[]
    value?: string
    defaultValue?: string
    onChange?: (id: string) => void
    name?: string
    required?: boolean
    allowAll?: boolean
    className?: string
}

export default function CategoryPicker({ categories, value, defaultValue = '', onChange, name = 'categoryId', required = false, allowAll = false, className = '' }: Props) {
    const [localValue, setLocalValue] = useState(defaultValue)
    const [query, setQuery] = useState('')
    const id = useId()
    const selectedId = value ?? localValue
    const labels = useMemo(() => categoryLabels(categories), [categories])
    const trail = categoryTrail(categories, selectedId)
    const choose = (next: string) => { setLocalValue(next); setQuery(''); onChange?.(next) }
    const levels = [categoryChildren(categories, null), ...trail.map((item) => categoryChildren(categories, item.id)).filter((items) => items.length > 0)]
    const normalized = query.trim().toLocaleLowerCase('uk-UA')
    const matches = normalized ? categories.filter((item) => labels.get(item.id)?.toLocaleLowerCase('uk-UA').includes(normalized)) : []
    return <div className={`category-picker ${className}`}>
        <input type="hidden" name={name} value={selectedId} />
        <input id={`${id}-search`} type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Пошук категорії чи підкатегорії" aria-label="Пошук категорії чи підкатегорії" disabled={!categories.length} />
        {normalized ? <select aria-label="Результати пошуку категорій" value={selectedId} required={required} onChange={(event) => choose(event.target.value)}>
            <option value="" disabled={!allowAll}>{matches.length ? 'Оберіть зі знайдених категорій' : 'Категорій не знайдено'}</option>
            {selectedId && !matches.some((item) => item.id === selectedId) && <option value={selectedId}>{labels.get(selectedId)}</option>}
            {matches.map((item) => <option key={item.id} value={item.id}>{labels.get(item.id)}</option>)}
        </select> : <div className="category-picker-levels">{levels.map((items, level) => <select key={level} aria-label={level === 0 ? 'Категорія' : `Підкатегорія, рівень ${level}`} value={trail[level]?.id ?? ''} required={required && level === 0} disabled={!categories.length} onChange={(event) => choose(event.target.value || trail[level - 1]?.id || '')}>
            <option value="" disabled={required && level === 0}>{level === 0 ? allowAll ? 'Усі категорії' : 'Оберіть категорію' : allowAll ? 'Усі підкатегорії' : 'Уточнити підкатегорію (необов’язково)'}</option>
            {items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
        </select>)}</div>}
        {!categories.length && <small role="status">Список категорій завантажується або недоступний.</small>}
        {trail.length > 0 && <div className="category-picker-selected"><CategoryImage category={trail[0]} /><span>{trail.map((item) => item.name).join(' › ')}</span>{allowAll && <button type="button" onClick={() => choose('')} aria-label="Очистити категорію">×</button>}</div>}
    </div>
}
