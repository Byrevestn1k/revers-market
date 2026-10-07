import { useEffect, useState, type FormEvent } from 'react'
import PhoneInput from './PhoneInput'

type Provider = 'google' | 'facebook' | 'telegram'
const providers: Provider[] = ['google', 'facebook', 'telegram']
const names: Record<Provider, string> = { google: 'Google', facebook: 'Facebook', telegram: 'Telegram' }
const providerIcon = (provider: Provider) => provider === 'telegram'
    ? <svg className="external-provider-icon external-provider-icon-telegram" viewBox="0 0 24 24" aria-hidden="true"><path d="M21 3 3 10.4l6.2 2.3L18.8 6l-7.2 8.4 1.3 6.6 3.4-4.6 4.7 3.3L21 3Z" /></svg>
    : <span className={`external-provider-icon external-provider-icon-${provider}`} aria-hidden="true">{provider === 'google' ? 'G' : 'f'}</span>
type Availability = Record<Provider, boolean>
type Identity = { provider: Provider; email: string | null; username: string | null; displayName: string | null }

const errorMessages: Record<string, string> = {
    'invalid-state': 'Спроба входу застаріла. Спробуйте ще раз.',
    cancelled: 'Вхід скасовано.',
    failed: 'Не вдалося увійти. Спробуйте ще раз або скористайтеся іншим способом.',
    'email-collision': 'Для цієї електронної адреси вже існує акаунт. Увійдіть у нього, щоб підключити цей спосіб входу.',
    'identity-conflict': 'Цей акаунт уже підключено до іншого профілю.',
    'provider-connected': 'Для цього способу входу вже підключено інший акаунт.',
    'reauth-required': 'Щоб підключити новий спосіб входу, підтвердьте, що це ваш акаунт.',
    'not-linked': 'Цей спосіб ще не підключений до вашого профілю. Увійдіть іншим способом.',
    linked: 'Спосіб входу підключено.',
}

export const externalAuthMessage = (code: string | null) => code ? errorMessages[code] ?? '' : ''
export const safeClientReturn = (value: string | null, fallback = '/dashboard') => {
    if (!value?.startsWith('/') || value.startsWith('//') || /[\\\x00-\x1f]/.test(value)) return fallback
    try {
        const url = new URL(value, window.location.origin)
        return url.origin === window.location.origin ? `${url.pathname}${url.search}` : fallback
    } catch { return fallback }
}

const fetchJson = async (path: string, options?: RequestInit) => {
    const response = await fetch(path, { credentials: 'include', ...options })
    if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { message?: string }
        throw new Error(body.message ?? 'Не вдалося виконати дію.')
    }
    return response.status === 204 ? null : response.json()
}

export function ExternalAuthOptions({ returnPath, originPage = 'login', excludeProvider = null }: { returnPath: string; originPage?: 'login' | 'register' | 'confirm'; excludeProvider?: Provider | null }) {
    const [available, setAvailable] = useState<Availability | null>(null)
    const [selected, setSelected] = useState<Provider | null>(null)
    useEffect(() => { void fetchJson('/api/auth/external/availability').then(data => setAvailable(data.providers)).catch(() => setAvailable(null)) }, [])
    if (!available || !providers.some(provider => available[provider] && provider !== excludeProvider)) return null
    return <div className="external-auth-options" aria-label="Інші способи входу">
        {providers.filter(provider => available[provider] && provider !== excludeProvider).map(provider =>
            <a key={provider} className="external-auth-button" aria-disabled={selected !== null}
                href={`/api/auth/external/${provider}/start?${new URLSearchParams({ intent: 'login', origin: originPage, return: safeClientReturn(returnPath) })}`}
                onClick={event => { if (selected) event.preventDefault(); else setSelected(provider) }}>
                {providerIcon(provider)}<span>{selected === provider ? `Переходимо до ${names[provider]}…` : `Продовжити з ${names[provider]}`}</span>
            </a>)}
        <div className="external-auth-divider"><span>або</span></div>
    </div>
}

export function LoginMethods({ onPasswordStatus }: { onPasswordStatus?: (hasPassword: boolean) => void }) {
    const [data, setData] = useState<{ password: boolean; providers: Availability; identities: Identity[] } | null>(null)
    const [error, setError] = useState('')
    const [pending, setPending] = useState<Provider | null>(null)
    const [busy, setBusy] = useState(false)
    const load = () => { void fetchJson('/api/auth/external/methods').then(next => { setData(next); onPasswordStatus?.(next.password) }).catch(() => setError('Не вдалося завантажити способи входу.')) }
    useEffect(load, [])
    useEffect(() => { const outcome = new URLSearchParams(window.location.search).get('externalAuth'); if (outcome) { setError(externalAuthMessage(outcome)); window.history.replaceState({}, '', '/settings/profile') } }, [])
    const startLink = async (provider: Provider) => {
        setBusy(true); setError('')
        try {
            const response = await fetch(`/api/auth/external/${provider}/start?${new URLSearchParams({ intent: 'link', return: '/settings/profile' })}`, { credentials: 'include', redirect: 'manual' })
            if (response.status === 403) {
                const body = await response.json().catch(() => ({})) as { message?: string }
                setError(body.message ?? 'Щоб підключити новий спосіб входу, підтвердьте, що це ваш акаунт.')
                return
            }
            const location = response.headers.get('location')
            if (!location) throw new Error('Не вдалося почати підключення способу входу.')
            window.location.assign(location)
        } catch (caught) { setError((caught as Error).message) }
        finally { setBusy(false) }
    }
    const unlink = async () => {
        if (!pending) return
        setBusy(true); setError('')
        try { await fetchJson(`/api/auth/external/methods/${pending}`, { method: 'DELETE' }); setPending(null); load() }
        catch (caught) { setError((caught as Error).message); setPending(null) }
        finally { setBusy(false) }
    }
    const identityLabel = (identity: Identity) => identity.provider === 'google' ? identity.email || identity.displayName || identity.username
        : identity.provider === 'telegram' && identity.username ? `@${identity.username.replace(/^@/, '')}`
            : identity.displayName || identity.email || identity.username
    return <section className="login-methods" aria-labelledby="login-methods-title">
        <h2 id="login-methods-title">Способи входу</h2>
        {error && <p className="form-error" role="alert">{error}</p>}
        {!data ? <p>Завантаження…</p> : <>
            <div className="login-method-row"><strong>Пароль</strong><span>{data.password ? 'Підключено' : 'Не встановлено'}</span></div>
            {providers.map(provider => {
                const identity = data.identities.find(item => item.provider === provider)
                return <div className="login-method-row" key={provider}>
                    <div><strong>{names[provider]}</strong><small>{identity ? identityLabel(identity) || 'Підключено' : data.providers[provider] ? 'Не підключено' : 'Зараз недоступно'}</small></div>
                    {identity ? <button type="button" className="outline-button" onClick={() => setPending(provider)}>Від’єднати</button>
                        : data.providers[provider] ? <button type="button" className="light-button" onClick={() => { void startLink(provider) }} disabled={busy}>Підключити</button> : null}
                </div>
            })}
        </>}
        {pending && <div className="modal-backdrop" role="presentation"><div className="unlink-dialog" role="dialog" aria-modal="true" aria-labelledby="unlink-title">
            <h3 id="unlink-title">Від’єднати {names[pending]}{data?.identities.find(item => item.provider === pending) ? ` ${identityLabel(data.identities.find(item => item.provider === pending)!) || ''}` : ''}?</h3><p>Після цього ви не зможете входити в цей профіль через цей акаунт.</p>
            <div className="unlink-actions"><button type="button" className="light-button" onClick={() => setPending(null)} disabled={busy}>Скасувати</button><button type="button" className="outline-button" onClick={unlink} disabled={busy}>{busy ? 'Зачекайте…' : 'Від’єднати'}</button></div>
        </div></div>}
    </section>
}

export function ExternalSignup({ onDone }: { onDone: (user: unknown, returnPath: string) => void }) {
    const [pending, setPending] = useState<{ provider: Provider; email: string | null; displayName: string | null; originPage: 'login' | 'register'; emailConflict: boolean } | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [choice, setChoice] = useState<'choice' | 'create' | 'existing'>(new URLSearchParams(window.location.search).has('existing') ? 'existing' : 'choice')
    const [countryCode, setCountryCode] = useState('UA')
    const [phone, setPhone] = useState('')
    useEffect(() => { void fetchJson('/api/auth/external/pending').then(setPending).catch(() => setError('Термін реєстрації минув. Почніть вхід ще раз.')) }, [])
    const cancel = async () => {
        setBusy(true)
        try { await fetchJson('/api/auth/external/pending/cancel', { method: 'POST' }); window.location.assign('/auth/login') }
        catch (caught) { setError((caught as Error).message); setBusy(false) }
    }
    const link = async () => {
        setBusy(true); setError('')
        try {
            const data = await fetchJson('/api/auth/external/finish/link', { method: 'POST' })
            onDone(data.user, safeClientReturn(data.returnPath))
        } catch (caught) { setError((caught as Error).message) }
        finally { setBusy(false) }
    }
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('')
        const form = Object.fromEntries(new FormData(event.currentTarget).entries())
        try {
            const data = await fetchJson('/api/auth/external/finish', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: form.username, email: form.email, countryCode, phone }) })
            onDone(data.user, safeClientReturn(data.returnPath))
        } catch (caught) { setError((caught as Error).message) }
        finally { setBusy(false) }
    }
    const create = pending && !pending.emailConflict && (choice === 'create' || pending.originPage === 'register' && choice !== 'existing')
    const existingUrl = `/auth/login?${new URLSearchParams({ confirmExternal: '1', return: '/auth/external/finish?existing=1' })}`
    return <main className="auth-page external-signup-page"><section className="auth-card">
        <h1>{choice === 'existing' ? 'Підключіть спосіб входу' : create ? 'Завершіть реєстрацію' : 'Оберіть свій профіль'}</h1>
        {pending && <p>{names[pending.provider]} ще не підключений до профілю ДещоТреба.</p>}
        {pending?.emailConflict && <p>Ця електронна адреса вже використовується. Увійдіть у свій акаунт, щоб підключити {names[pending.provider]}.</p>}
        {error && <p className="form-error" role="alert">{error}</p>}
        {pending && choice === 'existing' && <div className="external-auth-decision">
            <p>Після входу у свій існуючий акаунт підтвердьте підключення {names[pending.provider]}.</p>
            <button className="primary-button" onClick={link} disabled={busy}>{busy ? 'Зачекайте…' : `Підключити ${names[pending.provider]}`}</button>
            <a href={existingUrl}>Увійти в існуючий акаунт</a>
        </div>}
        {pending && !create && choice !== 'existing' && <div className="external-auth-decision">
            <p>Якщо у вас уже є профіль, увійдіть у нього, щоб підключити цей спосіб входу.</p>
            <a className="primary-button" href={existingUrl}>У мене вже є акаунт</a>
            {!pending.emailConflict && <button className="light-button" onClick={() => setChoice('create')}>Створити новий акаунт</button>}
        </div>}
        {create && <form onSubmit={submit}>
            <p>Вкажіть дані для нового профілю. Якщо профіль уже є, поверніться та увійдіть у нього.</p>
            <label>Логін<input name="username" required minLength={3} maxLength={32} pattern="[A-Za-z0-9_.-]+" autoComplete="username" /></label>
            <label>Електронна пошта<input name="email" type="email" required maxLength={254} defaultValue={pending.email ?? ''} autoComplete="email" /></label>
            <PhoneInput countryCode={countryCode} phone={phone} onCountryCode={setCountryCode} onPhone={setPhone} />
            <button className="primary-button" disabled={busy}>{busy ? 'Зачекайте…' : 'Створити акаунт'}</button>
            {pending.originPage === 'login' && <button type="button" className="text-button" onClick={() => setChoice('choice')}>Назад до вибору</button>}
        </form>}
        {pending && <button type="button" className="text-button" onClick={cancel} disabled={busy}>Скасувати</button>}
    </section></main>
}
