import { useEffect, useState } from 'react'
import CategoryPicker from './CategoryPicker'
import type { Category } from './categories'
import { CURRENCIES, LISTING_UNITS } from './listing-options'
import './listing-ui.css'

export function FieldError({ message }: { message?: string }) { return message ? <span className="field-error" role="alert">{message}</span> : null }
export function ListingBasics({ categories, categoryId, onCategoryChange, title, onTitleChange, description, errors = {}, categoryDisabled = false, targetType, decisionId }: {
    categories: Category[]; categoryId: string; onCategoryChange: (id: string) => void
    title: string; onTitleChange: (value: string) => void; description?: string; errors?: Record<string, string>; categoryDisabled?: boolean
    targetType?: 'product' | 'buy_request'; decisionId?: string | null
}) {
    const [draftDescription, setDraftDescription] = useState(description ?? '')
    const [assessment, setAssessment] = useState<{ level: string; certainty: 'identified' | 'uncertain'; reason: string | null; suggestions: { id: string; path: string }[] } | null>(null)
    const [appealMessage, setAppealMessage] = useState('')
    useEffect(() => {
        if (title.trim().length < 2) { setAssessment(null); return }
        const controller = new AbortController()
        const timer = window.setTimeout(() => {
            void fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/categories/recommend`, {
                method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ title, description: draftDescription, categoryId: categoryId || undefined }), signal: controller.signal,
            }).then(response => response.ok ? response.json() : null).then(value => { if (value) setAssessment(value) }).catch(() => undefined)
        }, 650)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [title, draftDescription, categoryId])
    const appeal = async () => {
        if (!targetType || !decisionId) return
        const response = await fetch(`${import.meta.env.VITE_API_URL ?? ''}/api/category-appeals`, {
            method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decisionId }),
        })
        const body = await response.json()
        setAppealMessage(response.ok ? 'Оскарження збережено для розгляду.' : body.message ?? 'Не вдалося подати оскарження.')
    }
    return <fieldset className="listing-section"><legend>Про оголошення</legend>
        <label>Назва товару<input name="title" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Наприклад, велосипед Trek Marlin 5" required minLength={2} maxLength={160} /><FieldError message={errors.title} /></label>
        <div className="listing-field"><span>Категорія та підкатегорія</span><CategoryPicker categories={categories} value={categoryId} onChange={onCategoryChange} required disabled={categoryDisabled} /><FieldError message={errors.categoryId} /></div>
        {assessment && (assessment.suggestions.length > 0 || assessment.certainty === 'uncertain' && Boolean(categoryId)) && <div className="category-recommendation" aria-live="polite">
            <strong>{assessment.reason ?? (assessment.certainty === 'uncertain' ? 'Категорію не вдалося визначити точно. Перевірте свій вибір.' : 'Рекомендована категорія:')}</strong>
            {assessment.suggestions.length > 0 && <div>{assessment.suggestions.map(item => <button type="button" key={item.id} disabled={categoryDisabled} onClick={() => onCategoryChange(item.id)}>{item.path}</button>)}</div>}
            {decisionId && targetType && <button type="button" className="text-button" onClick={() => void appeal()}>Оскаржити відхилення</button>}
            {appealMessage && <small role="status">{appealMessage}</small>}
        </div>}
        <label>Опис<textarea name="description" value={draftDescription} onChange={event => setDraftDescription(event.target.value)} rows={4} maxLength={5000} placeholder="Стан, характеристики та важливі умови" /><FieldError message={errors.description} /></label>
    </fieldset>
}
export function QuantityFields({ quantity = 1, unit = 'piece', errors = {} }: { quantity?: number; unit?: string; errors?: Record<string, string> }) {
    return <div className="field-row"><label>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue={quantity} required /><FieldError message={errors.quantity} /></label><label>Одиниця<select name="unit" defaultValue={unit}>{LISTING_UNITS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><FieldError message={errors.unit} /></label></div>
}
export function CurrencyField({ currency = 'UAH', error }: { currency?: string; error?: string }) { return <label>Валюта<select name="currency" defaultValue={currency}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select><FieldError message={error} /></label> }
