import CategoryPicker from './CategoryPicker'
import type { Category } from './categories'
import { CURRENCIES, LISTING_UNITS } from './listing-options'
import './listing-ui.css'

export function FieldError({ message }: { message?: string }) { return message ? <span className="field-error" role="alert">{message}</span> : null }
export function ListingBasics({ categories, categoryId, onCategoryChange, title, onTitleChange, description, errors = {} }: {
    categories: Category[]; categoryId: string; onCategoryChange: (id: string) => void
    title: string; onTitleChange: (value: string) => void; description?: string; errors?: Record<string, string>
}) {
    return <fieldset className="listing-section"><legend>Про оголошення</legend>
        <label>Назва товару<input name="title" value={title} onChange={(event) => onTitleChange(event.target.value)} placeholder="Наприклад, велосипед Trek Marlin 5" required minLength={2} maxLength={160} /><FieldError message={errors.title} /></label>
        <div className="listing-field"><span>Категорія та підкатегорія</span><CategoryPicker categories={categories} value={categoryId} onChange={onCategoryChange} required /><FieldError message={errors.categoryId} /></div>
        <label>Опис<textarea name="description" defaultValue={description ?? ''} rows={4} maxLength={5000} placeholder="Стан, характеристики та важливі умови" /><FieldError message={errors.description} /></label>
    </fieldset>
}
export function QuantityFields({ quantity = 1, unit = 'piece', errors = {} }: { quantity?: number; unit?: string; errors?: Record<string, string> }) {
    return <div className="field-row"><label>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue={quantity} required /><FieldError message={errors.quantity} /></label><label>Одиниця<select name="unit" defaultValue={unit}>{LISTING_UNITS.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select><FieldError message={errors.unit} /></label></div>
}
export function CurrencyField({ currency = 'UAH', error }: { currency?: string; error?: string }) { return <label>Валюта<select name="currency" defaultValue={currency}>{CURRENCIES.map((value) => <option key={value}>{value}</option>)}</select><FieldError message={error} /></label> }
