import { createContext, useCallback, useEffect, useMemo, useState, type ReactNode } from 'react'
import { PwaInvitation } from './pwa-install'
import { guideForPath, helpArticles } from './help-content'
import './help-center.css'
import { confirmListingNavigation, useUnsavedListingGuard } from './unsaved-listing'

const storageKey = 'deshchotreba-onboarding-v1'
export const HelpAuthContext = createContext<(ready: boolean, signedIn: boolean) => void>(() => undefined)
const pendingKey = 'deshchotreba.help.intent'
const pausedKey = 'deshchotreba.help.paused'
const resumablePaths = ['/my/products/new', '/my/requests/new', '/discover', '/settings/demand-subscriptions']
const readPaused = (): { path: string; step: number } | null => { try { const value = JSON.parse(localStorage.getItem(pausedKey) ?? 'null'); return value && resumablePaths.includes(value.path) && Number.isInteger(value.step) && value.step >= 0 && value.step < 30 ? value : null } catch { return null } }
const pendingIntent = () => { try { const value = sessionStorage.getItem(pendingKey); return value === '/my/requests/new' || value === '/my/products/new' || value === '/settings/demand-subscriptions' ? value : null } catch { return null } }
const storeIntent = (value: string | null) => { try { if (value) sessionStorage.setItem(pendingKey, value); else sessionStorage.removeItem(pendingKey) } catch { /* A same-page login still uses React state. */ } }
const seen = () => { try { return localStorage.getItem(storageKey) === 'done' } catch { return false } }
const remember = () => { try { localStorage.setItem(storageKey, 'done') } catch { /* The current session still stays dismissed. */ } }

export function HelpButton() {
    const open = () => window.dispatchEvent(new Event('help:open'))
    return <button type="button" className="help-button" aria-label="Центр допомоги" onPointerDown={open} onClick={open}>?</button>
}

function navigate(path: string): boolean {
    if (window.location.pathname === path) return true
    if (!confirmListingNavigation(path)) return false
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.dispatchEvent(new Event('help:location'))
    window.scrollTo(0, 0)
    return true
}

export function HelpCenter({ children }: { children: ReactNode }) {
    useUnsavedListingGuard()
    const [onboarding, setOnboarding] = useState(() => !seen())
    const [open, setOpen] = useState(false)
    const [minimized, setMinimized] = useState(false)
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState('Усі')
    const [path, setPath] = useState(window.location.pathname)
    const [step, setStep] = useState<number | null>(null)
    const [paused, setPaused] = useState<{ path: string; step: number } | null>(readPaused)
    const [targetMissing, setTargetMissing] = useState(false)
    const [scenarios, setScenarios] = useState(false)
    const [domRevision, setDomRevision] = useState(0)
    const [auth, setAuth] = useState({ ready: false, signedIn: false })
    const updateAuth = useCallback((ready: boolean, signedIn: boolean) => setAuth(previous => previous.ready === ready && previous.signedIn === signedIn ? previous : { ready, signedIn }), [])
    const [authIntent, setAuthIntent] = useState<string | null>(null)
    const [pending, setPending] = useState<string | null>(pendingIntent)
    useEffect(() => { try { if (paused && resumablePaths.includes(paused.path)) localStorage.setItem(pausedKey, JSON.stringify(paused)); else localStorage.removeItem(pausedKey) } catch { /* Training remains available in this tab. */ } }, [paused])
    const categories = useMemo(() => [...new Set(helpArticles.map(article => article.category))], [])
    const articles = useMemo(() => {
        const words = query.trim().toLocaleLowerCase('uk').split(/\s+/).filter(Boolean)
        return helpArticles.filter(article => (category === 'Усі' || article.category === category) && words.every(word => `${article.question} ${article.answer} ${article.category}`.toLocaleLowerCase('uk').includes(word)))
            .sort((a, b) => Number(b.context.some(prefix => path.startsWith(prefix))) - Number(a.context.some(prefix => path.startsWith(prefix))))
    }, [query, category, path])
    const steps = guideForPath(path).filter(item => !item.conditional || Boolean(item.selector && document.querySelector(item.selector)))
    useEffect(() => {
        const update = () => setDomRevision(value => value + 1)
        document.addEventListener('change', update)
        const form = document.querySelector('form.listing-form, .demand-subscriptions')
        const observer = new MutationObserver(update)
        if (form) observer.observe(form, { childList: true, subtree: true })
        return () => { document.removeEventListener('change', update); observer.disconnect() }
    }, [path])
    useEffect(() => {
        if (step === null || !open || minimized) return
        const selector = steps[step]?.selector
        const target = selector ? document.querySelector(selector) : null
        if (!target) return
        target.scrollIntoView({ behavior: 'smooth', block: 'center' })
        target.classList.add('help-target')
        return () => target.classList.remove('help-target')
    }, [step, path, domRevision, open, minimized])
    useEffect(() => {
        const show = () => { setOpen(true); setMinimized(false) }
        const sync = () => { setPath(window.location.pathname); setStep(null) }
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (onboarding) { remember(); setOnboarding(false); setAuthIntent(null) } else { if (step !== null) setPaused({ path, step }); setOpen(false); setStep(null) } } }
        window.addEventListener('help:open', show)
        window.addEventListener('help:location', sync)
        window.addEventListener('popstate', sync)
        window.addEventListener('keydown', escape)
        return () => { window.removeEventListener('help:open', show); window.removeEventListener('help:location', sync); window.removeEventListener('popstate', sync); window.removeEventListener('keydown', escape) }
    }, [onboarding, path, step])
    useEffect(() => {
        if (!pending || !auth.ready) return
        if (path !== pending && !path.startsWith('/auth/')) { storeIntent(null); setPending(null); return }
        if (path !== pending || !auth.signedIn) return
        const start = () => {
            if (!document.querySelector(pending === '/settings/demand-subscriptions' ? '.demand-subscriptions' : 'form.product-form.listing-form input[name="title"]')) return false
            const available = guideForPath(pending).filter(item => !item.conditional || Boolean(item.selector && document.querySelector(item.selector)))
            storeIntent(null); setPending(null); setOpen(true); setMinimized(false); setStep(paused?.path === pending ? Math.min(paused.step, Math.max(0, available.length - 1)) : 0); setPaused(null)
            return true
        }
        if (start()) return
        const observer = new MutationObserver(() => { if (start()) observer.disconnect() })
        observer.observe(document.body, { childList: true, subtree: true })
        return () => observer.disconnect()
    }, [pending, auth, path, paused])
    const finish = () => { remember(); setOnboarding(false); setAuthIntent(null) }
    const choose = (destination: string) => {
        if (destination !== '/discover' && !auth.signedIn) { setScenarios(false); setOnboarding(true); setAuthIntent(destination); return }
        if (!navigate(destination)) return
        finish(); setScenarios(false); setPaused(null)
        if (destination === '/discover') { setOpen(true); setMinimized(false); setStep(0) }
        else { storeIntent(destination); setPending(destination) }
    }
    const continueToLogin = () => {
        if (!authIntent || !navigate('/auth/login?' + new URLSearchParams({ return: authIntent }))) return
        storeIntent(authIntent); setPending(authIntent); setOpen(false); setStep(null); finish()
    }
    const resume = () => {
        if (!paused) return
        if (paused.path === path) { setStep(Math.min(paused.step, steps.length - 1)); setPaused(null); return }
        if (paused.path !== '/discover' && !auth.signedIn) { setOnboarding(true); setAuthIntent(paused.path); return }
        if (!navigate(paused.path)) return
        if (!['/my/products/new', '/my/requests/new', '/settings/demand-subscriptions'].includes(paused.path)) { setStep(paused.step); setPaused(null) }
        else { storeIntent(paused.path); setPending(paused.path) }
    }
    const openLink = (destination: string) => {
        if (!navigate(destination)) return
        setStep(null)
        if (window.matchMedia('(max-width: 767px)').matches) setMinimized(true)
    }
    const showTarget = () => {
        const selector = step === null ? undefined : steps[step]?.selector
        if (!selector) return
        const target = document.querySelector(selector)
        if (target) { setTargetMissing(false); if (window.matchMedia('(max-width: 767px)').matches) setMinimized(true); target.scrollIntoView({ behavior: 'smooth', block: 'center' }); target.classList.add('help-target'); window.setTimeout(() => target.classList.remove('help-target'), 3000) }
        else setTargetMissing(true)
    }
    return <HelpAuthContext.Provider value={updateAuth}>
        <PwaInvitation suppressed={onboarding || open} />
        {children}
        {onboarding && <div className="help-welcome-backdrop"><section className="help-welcome" role="dialog" aria-modal="true" aria-labelledby="help-welcome-title">
            {authIntent ? <><h1 id="help-welcome-title">Потрібен вхід</h1><p>{authIntent === '/settings/demand-subscriptions' ? 'Для налаштування підписки потрібно увійти. Після входу відкриються підписки з підказками.' : 'Для публікації товару або запиту потрібно увійти. Після входу відкриється вибрана форма з підказками.'}</p><button type="button" onClick={continueToLogin}>Увійти або зареєструватися</button><button type="button" className="help-text-button" onClick={() => setAuthIntent(null)}>Назад до вибору</button></> : <><h1 id="help-welcome-title">Що ви хочете зробити?</h1><p>Оберіть напрямок, щоб побачити короткі підказки. Почати можна будь-коли.</p>
            <button type="button" onClick={() => choose('/discover')}><strong>Знайти товар</strong><span>Пошук і мапа товарів поруч</span></button>
            <button type="button" disabled={!auth.ready} onClick={() => choose('/my/requests/new')}><strong>Створити запит</strong><span>Розкажіть, що шукаєте, а продавці зможуть запропонувати товари</span></button>
            <button type="button" disabled={!auth.ready} onClick={() => choose('/my/products/new')}><strong>Продати товар</strong><span>Опублікуйте товар або знайдіть запити покупців</span></button></>}
            <button type="button" className="help-text-button" onClick={finish}>Пропустити вступ</button>
        </section></div>}
        {open && !onboarding && <aside className={'help-panel' + (minimized ? ' help-panel-minimized' : '')} aria-label="Центр допомоги">
            <header><strong>Центр допомоги</strong><div><button type="button" onClick={() => setMinimized(value => !value)}>{minimized ? 'Розгорнути' : 'Згорнути'}</button><button type="button" aria-label="Закрити допомогу" onClick={() => { if (step !== null) setPaused({ path, step }); setOpen(false); setStep(null) }}>×</button></div></header>
            {!minimized && <div className="help-panel-body">
                <button type="button" className="help-text-button" onClick={() => { setOpen(false); setOnboarding(true) }}>Почати вступ знову</button>
                <button type="button" className="help-guide-start" onClick={() => setScenarios(value => !value)}>Пройти навчання</button>
                <button type="button" className="help-text-button" onClick={() => setScenarios(true)}>Повторити навчання</button>
                {step === null && paused && <button type="button" className="help-guide-start" disabled={!auth.ready && paused.path !== '/discover'} onClick={resume}>Продовжити навчання</button>}
                {scenarios && <div className="help-scenarios"><button type="button" onClick={() => choose('/my/products/new')}>Створення товару</button><button type="button" onClick={() => choose('/my/requests/new')}>Створення запиту</button><button type="button" onClick={() => choose('/discover')}>Пошук і мапа</button><button type="button" onClick={() => choose('/settings/demand-subscriptions')}>Підписки на запити</button></div>}
                {step === null ? <button type="button" className="help-guide-start" onClick={() => { setTargetMissing(false); setStep(0) }}>Допомога на цій сторінці</button> : <section className="help-guide" aria-label="Покрокові підказки"><strong>Крок {step + 1} з {steps.length}</strong><p>{steps[step]?.text}</p>{targetMissing && <p role="status">Елемент з’явиться після відкриття відповідного розділу або форми.</p>}<div>{steps[step]?.selector && document.querySelector(steps[step].selector!) && <button type="button" onClick={showTarget}>Показати елемент</button>}<button type="button" disabled={step === 0} onClick={() => setStep(Math.max(0, step - 1))}>Назад</button><button type="button" onClick={() => { setTargetMissing(false); if (step + 1 < steps.length) setStep(step + 1); else { setStep(null); setPaused(null) } }}>{step + 1 < steps.length ? 'Далі' : 'Завершити'}</button>{step + 1 < steps.length && <button type="button" onClick={() => setStep(step + 1)}>Пропустити</button>}<button type="button" onClick={() => { setPaused({ path, step }); setStep(null) }}>Зупинити й продовжити пізніше</button><button type="button" onClick={() => { setPaused(null); setStep(null) }}>Завершити навчання</button></div></section>}
                <label className="help-search">Пошук у запитаннях<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Наприклад, доставка" /></label>
                <label className="help-search">Категорія<select value={category} onChange={event => setCategory(event.target.value)}><option>Усі</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
                <p className="help-context">Спочатку показано запитання, пов’язані з цією сторінкою.</p>
                {!articles.length && <p>Нічого не знайдено. Спробуйте інші слова або виберіть усі категорії.</p>}
                {articles.map(article => <details key={article.question}><summary>{article.question}</summary><small>{article.category}</small><p>{article.answer}</p><button type="button" className="help-text-button" onClick={() => openLink(article.path)}>{article.link} →</button></details>)}
            </div>}
        </aside>}
    </HelpAuthContext.Provider>
}
