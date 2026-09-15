import { useEffect, useMemo, useRef, useState } from 'react'
import { COUNTRIES, digitsOf, flagUrl, findCountry, formatPhone, loadCountries, type Country } from './countries'

/** Вибір коду країни з прапорцем + поле номера з маскою (97) 111-11-11 і валідацією довжини країни. */
export default function PhoneInput({ countryCode, phone, onCountryCode, onPhone, error }: {
    countryCode: string
    phone: string
    onCountryCode: (code: string) => void
    onPhone: (phone: string) => void
    error?: string
}) {
    const [countries, setCountries] = useState<Country[]>(COUNTRIES)
    const [open, setOpen] = useState(false)
    const [query, setQuery] = useState('')
    const rootRef = useRef<HTMLDivElement>(null)
    const selected = findCountry(countryCode, countries)

    useEffect(() => { loadCountries().then(setCountries) }, [])
    useEffect(() => {
        if (!open) return
        const onClick = (event: MouseEvent) => { if (!rootRef.current?.contains(event.target as Node)) setOpen(false) }
        document.addEventListener('mousedown', onClick)
        return () => document.removeEventListener('mousedown', onClick)
    }, [open])

    const filtered = useMemo(() => {
        const q = query.trim().toLocaleLowerCase('uk')
        if (!q) return countries
        return countries.filter((country) =>
            country.name.toLocaleLowerCase('uk').includes(q)
            || country.name.toLowerCase().includes(q)
            || country.code.toLowerCase().includes(q)
            || country.dial.includes(q.replace(/^\+/, '')),
        )
    }, [countries, query])

    const digits = digitsOf(phone)
    const lengthOk = Boolean(selected && digits.length >= selected.min && digits.length <= selected.max)

    const changePhone = (raw: string) => onPhone(formatPhone(digitsOf(raw).slice(0, selected?.max ?? 15)))
    const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
        if (event.key !== 'Backspace' || !digits.length) return
        event.preventDefault()
        onPhone(formatPhone(digits.slice(0, -1)))
    }

    return (
        <div className="phone-input-wrap" ref={rootRef}>
            <label className="phone-country">
                Код країни
                <button type="button" className="phone-country-button" onClick={() => { setOpen(!open); setQuery('') }} aria-haspopup="listbox" aria-expanded={open}>
                    <img className="phone-flag" src={flagUrl(selected?.code ?? 'un')} alt="" width={26} height={18} />
                    <span className="phone-country-code">+{selected?.dial ?? ''}</span>
                    <span className="phone-caret">▾</span>
                </button>
                {open && (
                    <div className="phone-dropdown" role="listbox">
                        <input
                            className="phone-search"
                            value={query}
                            autoFocus
                            placeholder="Пошук країни або коду…"
                            onChange={(event) => setQuery(event.target.value)}
                        />
                        <div className="phone-options">
                            {filtered.map((country) => (
                                <button
                                    type="button"
                                    key={country.code}
                                    role="option"
                                    aria-selected={country.code === countryCode}
                                    className={country.code === countryCode ? 'selected' : ''}
                                    onClick={() => { onCountryCode(country.code); setOpen(false) }}
                                >
                                    <img className="phone-flag" src={flagUrl(country.code)} alt="" width={26} height={18} loading="lazy" />
                                    <span className="phone-name">{country.name}</span>
                                    <span className="phone-dial">+{country.dial}</span>
                                </button>
                            ))}
                            {!filtered.length && <span className="phone-empty">Нічого не знайдено</span>}
                        </div>
                    </div>
                )}
            </label>
            <label className="phone-number">
                Номер телефону
                <input
                    value={phone}
                    onChange={(event) => changePhone(event.target.value)}
                    onKeyDown={onKeyDown}
                    inputMode="tel"
                    placeholder="(97)-111-11-11"
                    required
                />
            </label>
            {selected && digits.length > 0 && (
                <small className={`phone-hint${lengthOk ? '' : ' invalid'}`}>
                    {lengthOk
                        ? `✓ Цифр: ${digits.length} — коректно для +${selected.dial}`
                        : `Має бути ${selected.min === selected.max ? selected.min : `${selected.min}–${selected.max}`} цифр — зараз ${digits.length}`}
                </small>
            )}
            {error && <span className="field-error">{error}</span>}
        </div>
    )
}
