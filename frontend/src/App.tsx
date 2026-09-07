import { FormEvent, useEffect, useState } from 'react'

type User = { username: string; countryCode: string; phone: string }
type Mode = 'register' | 'login'
type ApiError = Error & { fields?: string[] }
const countryOptions = [
    { code: 'UA', dial: '+380', min: 9, max: 10 },
    { code: 'PL', dial: '+48', min: 9, max: 9 },
    { code: 'DE', dial: '+49', min: 10, max: 11 },
    { code: 'CZ', dial: '+420', min: 9, max: 9 },
    { code: 'SK', dial: '+421', min: 9, max: 9 },
    { code: 'RO', dial: '+40', min: 9, max: 9 },
    { code: 'HU', dial: '+36', min: 9, max: 9 },
    { code: 'LT', dial: '+370', min: 8, max: 8 },
    { code: 'LV', dial: '+371', min: 8, max: 8 },
    { code: 'EE', dial: '+372', min: 7, max: 8 },
    { code: 'MD', dial: '+373', min: 8, max: 8 },
    { code: 'GB', dial: '+44', min: 10, max: 10 },
    { code: 'US', dial: '+1', min: 10, max: 10 },
    { code: 'CA', dial: '+1', min: 10, max: 10 },
]

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'

async function request(path: string, options?: RequestInit) {
    let response: Response
    try {
        response = await fetch(`${apiUrl}${path}`, {
            ...options,
            credentials: 'include',
            headers: { 'Content-Type': 'application/json', ...options?.headers },
        })
    } catch {
        throw new Error('Не вдалося з’єднатися із сервером')
    }
    const body = response.status === 204 ? null : await response.json()
    if (!response.ok) {
        const error = new Error(body?.message ?? 'Не вдалося виконати запит') as ApiError
        error.fields = body?.fields ?? []
        throw error
    }
    return body
}

function App() {
    const [mode, setMode] = useState<Mode>('register')
    const [user, setUser] = useState<User | null>(null)
    const [error, setError] = useState('')
    const [errorFields, setErrorFields] = useState<string[]>([])
    const [notice, setNotice] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmation, setShowConfirmation] = useState(false)
    const [busy, setBusy] = useState(false)
    const [countryCode, setCountryCode] = useState('UA')
    const [phone, setPhone] = useState('')

    useEffect(() => {
        request('/api/auth/me').then((result) => setUser(result.user)).catch(() => undefined)
    }, [])

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setError('')
        setErrorFields([])
        setNotice('')
        setBusy(true)
        const form = new FormData(event.currentTarget)
        const payload = Object.fromEntries(form.entries())
        if (mode === 'register') {
            const country = countryOptions.find((option) => option.code === countryCode) ?? countryOptions[0]
            const enteredPhone = String(payload.phone ?? '').trim()
            payload.countryCode = country.code
            payload.phone = enteredPhone
        }
        try {
            const result = await request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) })
            setUser(result.user)
            setNotice(mode === 'register' ? 'Обліковий запис створено' : 'Ви увійшли в обліковий запис')
        } catch (requestError) {
            const apiError = requestError as ApiError
            setError(apiError instanceof Error ? apiError.message : 'Невідома помилка')
            setErrorFields(apiError.fields ?? [])
        } finally {
            setBusy(false)
        }
    }

    const hasFieldError = (field: string) => errorFields.some((message) => {
        if (field === 'username') return message.includes('Ім’я користувача')
        if (field === 'countryCode') return message.includes('код країни')
        if (field === 'phone') return message.includes('номер телефону')
        if (field === 'password') return message.startsWith('Пароль:')
        if (field === 'passwordConfirmation') return message.includes('Паролі')
        return false
    })
    const selectedCountry = countryOptions.find((option) => option.code === countryCode) ?? countryOptions[0]

    const signOut = async () => {
        await request('/api/auth/logout', { method: 'POST' })
        setUser(null)
        setNotice('Ви вийшли з облікового запису')
    }

    return (
        <main className="shell">
            <section className="auth-layout" aria-labelledby="page-title">
                <div className="intro">
                    <h1 id="page-title">Обліковий запис</h1>
                </div>
                <div className="auth-panel">
                    {user ? (
                        <div className="signed-in">
                            <p className="panel-label">Ви увійшли як</p>
                            <h2>{user.username}</h2>
                            <p>{user.countryCode} · {user.phone}</p>
                            <button className="button secondary" type="button" onClick={signOut}>Вийти</button>
                        </div>
                    ) : (
                        <>
                            <div className="mode-switch" role="tablist" aria-label="Дія з обліковим записом">
                                <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>Реєстрація</button>
                                <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>Вхід</button>
                            </div>
                            <form onSubmit={submit} noValidate>
                                <label className={hasFieldError('username') ? 'invalid' : ''}>Ім’я користувача<input className={hasFieldError('username') ? 'invalid' : ''} name="username" autoComplete="username" required minLength={3} maxLength={32} /></label>
                                {mode === 'register' && <div className="two-columns">
                                    <label className={hasFieldError('countryCode') ? 'invalid' : ''}>Код країни<select className={hasFieldError('countryCode') ? 'invalid' : ''} name="countryCode" value={countryCode} onChange={(event) => setCountryCode(event.target.value)} required>{countryOptions.map((option) => <option key={option.code} value={option.code}>{option.code} {option.dial}</option>)}</select></label>
                                    <label className={hasFieldError('phone') ? 'invalid' : ''}>Телефон<input className={hasFieldError('phone') ? 'invalid' : ''} name="phone" type="tel" inputMode="numeric" pattern="[0-9]*" minLength={selectedCountry.min} maxLength={selectedCountry.max} autoComplete="tel" value={phone} onChange={(event) => setPhone(event.target.value.replace(/\D/g, ''))} required /></label>
                                </div>}
                                <label className={hasFieldError('password') ? 'invalid' : ''}>Пароль<div className={`password-field${hasFieldError('password') ? ' invalid' : ''}`}><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required /><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Сховати' : 'Показати'}</button></div></label>
                                {mode === 'register' && <label className={hasFieldError('passwordConfirmation') ? 'invalid' : ''}>Підтвердження пароля<div className={`password-field${hasFieldError('passwordConfirmation') ? ' invalid' : ''}`}><input name="passwordConfirmation" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" required /><button type="button" className="password-toggle" onClick={() => setShowConfirmation(!showConfirmation)}>{showConfirmation ? 'Сховати' : 'Показати'}</button></div></label>}
                                {error && <div className="form-message error" role="alert"><p>{error}</p>{errorFields.length > 0 && <ul>{errorFields.map((fieldError) => <li key={fieldError}>{fieldError}</li>)}</ul>}</div>}
                                {notice && <p className="form-message success" role="status">{notice}</p>}
                                <button className="button" type="submit" disabled={busy}>{busy ? 'Зачекайте...' : mode === 'register' ? 'Створити обліковий запис' : 'Увійти'}</button>
                            </form>
                        </>
                    )}
                </div>
            </section>
        </main>
    )
}

export default App
