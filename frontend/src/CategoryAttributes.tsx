import { useEffect, useState } from 'react'

type Definition = { code: string; label: string; valueType: 'text' | 'number' | 'number_unit' | 'single' | 'multiple' | 'boolean'; options: string[]; unit: string | null; minValue: number | null; maxValue: number | null; required: boolean }
export type AttributeValues = Record<string, string | number | boolean | string[]>

export function AttributeComparison({ categoryId, buyer, seller }: { categoryId: string; buyer?: AttributeValues; seller?: AttributeValues }) {
    const [definitions, setDefinitions] = useState<Definition[]>([])
    useEffect(() => {
        if (!categoryId) return
        const controller = new AbortController()
        fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/categories/${encodeURIComponent(categoryId)}/attributes`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : Promise.reject()).then(result => setDefinitions(result.attributes)).catch(() => undefined)
        return () => controller.abort()
    }, [categoryId])
    const format = (value: AttributeValues[string] | undefined, unit: string | null) => value === undefined ? 'Не вказано' : `${Array.isArray(value) ? value.join(', ') : typeof value === 'boolean' ? value ? 'Так' : 'Ні' : String(value)}${unit ? ` ${unit}` : ''}`
    const entries = definitions.filter(definition => buyer?.[definition.code] !== undefined || seller?.[definition.code] !== undefined)
    if (!entries.length) return null
    return <div className="seller-offer-comparison" role="table" aria-label="Порівняння характеристик"><div className="seller-offer-compare-head" role="row"><span>Характеристика</span><span>Покупець шукає</span><span>Продавець пропонує</span></div>{entries.map(definition => { const left = format(buyer?.[definition.code], definition.unit); const right = format(seller?.[definition.code], definition.unit); return <div className="seller-offer-compare-row" role="row" key={definition.code}><b>{definition.label}</b><span>{left}</span><span className={left !== right ? 'seller-offer-difference' : ''}>{right}</span></div> })}</div>
}

export function AttributeSummary({ categoryId, value }: { categoryId: string; value?: AttributeValues }) {
    const [definitions, setDefinitions] = useState<Definition[]>([])
    useEffect(() => {
        if (!categoryId || !value || !Object.keys(value).length) return
        const controller = new AbortController()
        fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/categories/${encodeURIComponent(categoryId)}/attributes`, { signal: controller.signal })
            .then(response => response.ok ? response.json() : Promise.reject()).then(result => setDefinitions(result.attributes)).catch(() => undefined)
        return () => controller.abort()
    }, [categoryId, value])
    const entries = definitions.filter(definition => value?.[definition.code] !== undefined)
    if (!entries.length) return null
    return <section className="listing-description"><h2>Характеристики</h2><dl>{entries.map(definition => { const item = value![definition.code]; return <div key={definition.code}><dt>{definition.label}</dt><dd>{Array.isArray(item) ? item.join(', ') : typeof item === 'boolean' ? item ? 'Так' : 'Ні' : String(item)}{definition.unit ? ` ${definition.unit}` : ''}</dd></div> })}</dl></section>
}

export default function CategoryAttributes({ categoryId, value, onChange, sourceText = '' }: { categoryId: string; value: AttributeValues; onChange: (value: AttributeValues) => void; sourceText?: string }) {
    const [definitions, setDefinitions] = useState<Definition[]>([])
    const [error, setError] = useState('')
    useEffect(() => {
        setDefinitions([]); setError('')
        if (!categoryId) return
        const controller = new AbortController()
        fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/categories/${encodeURIComponent(categoryId)}/attributes`, { credentials: 'include', signal: controller.signal })
            .then(response => { if (!response.ok) throw new Error(); return response.json() })
            .then(result => setDefinitions(result.attributes))
            .catch(() => { if (!controller.signal.aborted) setError('Не вдалося завантажити характеристики. Спробуйте оновити сторінку.') })
        return () => controller.abort()
    }, [categoryId])
    const update = (code: string, next: AttributeValues[string] | undefined) => {
        const copy = { ...value }
        if (next === undefined) delete copy[code]; else copy[code] = next
        onChange(copy)
    }
    if (!definitions.length && !error) return null
    const storageMatch = /(?:^|\s)(\d{1,5})\s*(?:гб|gb)(?=\s|$|[,.])/iu.exec(sourceText)
    const storageSuggestion = definitions.find(item => item.code === 'storage' && value.storage === undefined && storageMatch && Number(storageMatch[1]) <= (item.maxValue ?? Infinity))
    return <fieldset className="listing-section"><legend>Характеристики категорії</legend><p className="form-hint">Заповнюйте відомі характеристики; опис можна залишити окремо.</p>
        {storageSuggestion && storageMatch && <p className="form-hint">Знайдено в назві: пам’ять {storageMatch[1]} ГБ. <button type="button" onClick={() => update('storage', Number(storageMatch[1]))}>Застосувати підказку</button></p>}
        {error && <p role="alert" className="form-error">{error}</p>}
        {definitions.map(definition => <div key={definition.code} className="listing-field">
            {definition.valueType === 'multiple' ? <fieldset><legend>{definition.label}</legend>{definition.options.map(option => <label key={option}><input type="checkbox" checked={Array.isArray(value[definition.code]) && (value[definition.code] as string[]).includes(option)} onChange={event => { const previous = Array.isArray(value[definition.code]) ? value[definition.code] as string[] : []; const next = event.target.checked ? [...previous, option] : previous.filter(item => item !== option); update(definition.code, next.length ? next : undefined) }} /> {option}</label>)}</fieldset>
                : definition.valueType === 'boolean' ? <label>{definition.label}<select value={value[definition.code] === undefined ? '' : String(value[definition.code])} onChange={event => update(definition.code, event.target.value === '' ? undefined : event.target.value === 'true')}><option value="">Не вказано</option><option value="true">Так</option><option value="false">Ні</option></select></label>
                : definition.valueType === 'single' ? <label>{definition.label}<select value={String(value[definition.code] ?? '')} required={definition.required} onChange={event => update(definition.code, event.target.value || undefined)}><option value="">Не вказано</option>{definition.options.map(option => <option key={option}>{option}</option>)}</select></label>
                : <label>{definition.label}{definition.unit ? ` (${definition.unit})` : ''}<input type={definition.valueType === 'text' ? 'text' : 'number'} value={String(value[definition.code] ?? '')} required={definition.required} min={definition.minValue ?? undefined} max={definition.maxValue ?? undefined} maxLength={definition.valueType === 'text' ? 200 : undefined} step={definition.valueType === 'text' ? undefined : 'any'} onChange={event => update(definition.code, event.target.value === '' ? undefined : definition.valueType === 'text' ? event.target.value : Number(event.target.value))} /></label>}
        </div>)}
    </fieldset>
}
