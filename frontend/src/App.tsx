import { FormEvent, useEffect, useState } from 'react'

type User = { username: string; countryCode: string; phone: string }
type Mode = 'register' | 'login'

const apiUrl = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${apiUrl}${path}`, {
        ...options,
        credentials: 'include',
        headers: { 'Content-Type': 'application/json', ...options?.headers },
    })
    const body = response.status === 204 ? null : await response.json()
    if (!response.ok) throw new Error(body?.message ?? 'Не удалось выполнить запрос')
    return body
}

function App() {
    const [mode, setMode] = useState<Mode>('register')
    const [user, setUser] = useState<User | null>(null)
    const [error, setError] = useState('')
    const [notice, setNotice] = useState('')
    const [showPassword, setShowPassword] = useState(false)
    const [showConfirmation, setShowConfirmation] = useState(false)
    const [busy, setBusy] = useState(false)

    useEffect(() => {
        request('/api/auth/me').then((result) => setUser(result.user)).catch(() => undefined)
    }, [])

    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        setError('')
        setNotice('')
        setBusy(true)
        const form = new FormData(event.currentTarget)
        const payload = Object.fromEntries(form.entries())
        try {
            const result = await request(`/api/auth/${mode}`, { method: 'POST', body: JSON.stringify(payload) })
            setUser(result.user)
            setNotice(mode === 'register' ? 'Аккаунт создан' : 'Вы вошли в аккаунт')
        } catch (requestError) {
            setError(requestError instanceof Error ? requestError.message : 'Неизвестная ошибка')
        } finally {
            setBusy(false)
        }
    }

    const signOut = async () => {
        await request('/api/auth/logout', { method: 'POST' })
        setUser(null)
        setNotice('Вы вышли из аккаунта')
    }

    return (
        <main className="shell">
            <section className="auth-layout" aria-labelledby="page-title">
                <div className="intro">
                    <p className="eyebrow">Navpaky / account</p>
                    <h1 id="page-title">Простір для наступного кроку.</h1>
                    <p className="description">Создайте аккаунт, чтобы продолжить работу с платформой.</p>
                </div>
                <div className="auth-panel">
                    {user ? (
                        <div className="signed-in">
                            <p className="panel-label">Вы вошли как</p>
                            <h2>{user.username}</h2>
                            <p>{user.countryCode} · {user.phone}</p>
                            <button className="button secondary" type="button" onClick={signOut}>Выйти</button>
                        </div>
                    ) : (
                        <>
                            <div className="mode-switch" role="tablist" aria-label="Действие с аккаунтом">
                                <button className={mode === 'register' ? 'active' : ''} type="button" onClick={() => setMode('register')}>Регистрация</button>
                                <button className={mode === 'login' ? 'active' : ''} type="button" onClick={() => setMode('login')}>Вход</button>
                            </div>
                            <form onSubmit={submit} noValidate>
                                <label>Username<input name="username" autoComplete="username" required minLength={3} maxLength={32} /></label>
                                {mode === 'register' && <div className="two-columns">
                                    <label>Country code<input name="countryCode" placeholder="UA" maxLength={2} required /></label>
                                    <label>Телефон<input name="phone" type="tel" autoComplete="tel" placeholder="+380..." required /></label>
                                </div>}
                                <label>Пароль<div className="password-field"><input name="password" type={showPassword ? 'text' : 'password'} autoComplete={mode === 'register' ? 'new-password' : 'current-password'} required /><button type="button" className="password-toggle" onClick={() => setShowPassword(!showPassword)}>{showPassword ? 'Скрыть' : 'Показать'}</button></div></label>
                                {mode === 'register' && <label>Подтверждение пароля<div className="password-field"><input name="passwordConfirmation" type={showConfirmation ? 'text' : 'password'} autoComplete="new-password" required /><button type="button" className="password-toggle" onClick={() => setShowConfirmation(!showConfirmation)}>{showConfirmation ? 'Скрыть' : 'Показать'}</button></div></label>}
                                {error && <p className="form-message error" role="alert">{error}</p>}
                                {notice && <p className="form-message success" role="status">{notice}</p>}
                                <button className="button" type="submit" disabled={busy}>{busy ? 'Подождите...' : mode === 'register' ? 'Создать аккаунт' : 'Войти'}</button>
                            </form>
                        </>
                    )}
                </div>
            </section>
            <footer className="footer"><span>Frontend · React · TypeScript</span><span>Secure account access</span></footer>
        </main>
    )
}

export default App
