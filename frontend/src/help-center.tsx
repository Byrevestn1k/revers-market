import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { PwaInvitation } from './pwa-install'
import { guideForPath, helpArticles } from './help-content'
import './help-center.css'

const storageKey = 'deshchotreba-onboarding-v1'
const changedForms = new WeakSet<HTMLFormElement>()
const seen = () => { try { return localStorage.getItem(storageKey) === 'done' } catch { return false } }
const remember = () => { try { localStorage.setItem(storageKey, 'done') } catch { /* The current session still stays dismissed. */ } }

export function HelpButton() {
    const open = () => window.dispatchEvent(new Event('help:open'))
    return <button type="button" className="help-button" aria-label="Центр допомоги" onPointerDown={open} onClick={open}>?</button>
}

function navigate(path: string): boolean {
    if (window.location.pathname === path) return true
    const hasChangedForm = Array.from(document.querySelectorAll('form')).some(form => changedForms.has(form))
    if (hasChangedForm) {
        if (!window.confirm('Перехід на іншу сторінку може стерти незбережені дані форми. Перейти?')) return false
    }
    window.history.pushState({}, '', path)
    window.dispatchEvent(new PopStateEvent('popstate'))
    window.dispatchEvent(new Event('help:location'))
    window.scrollTo(0, 0)
    return true
}

export function HelpCenter({ children }: { children: ReactNode }) {
    const [onboarding, setOnboarding] = useState(() => !seen())
    const [open, setOpen] = useState(false)
    const [minimized, setMinimized] = useState(false)
    const [query, setQuery] = useState('')
    const [category, setCategory] = useState('Усі')
    const [path, setPath] = useState(window.location.pathname)
    const [step, setStep] = useState<number | null>(null)
    const [targetMissing, setTargetMissing] = useState(false)
    const categories = useMemo(() => [...new Set(helpArticles.map(article => article.category))], [])
    const articles = useMemo(() => {
        const words = query.trim().toLocaleLowerCase('uk').split(/\s+/).filter(Boolean)
        return helpArticles.filter(article => (category === 'Усі' || article.category === category) && words.every(word => `${article.question} ${article.answer} ${article.category}`.toLocaleLowerCase('uk').includes(word)))
            .sort((a, b) => Number(b.context.some(prefix => path.startsWith(prefix))) - Number(a.context.some(prefix => path.startsWith(prefix))))
    }, [query, category, path])
    const steps = guideForPath(path)
    useEffect(() => {
        const show = () => { setOpen(true); setMinimized(false) }
        const sync = () => { setPath(window.location.pathname); setStep(null) }
        const markChanged = (event: Event) => { const target = event.target; if (target instanceof HTMLElement) { const form = target.closest('form'); if (form && !form.matches('[role="search"]')) changedForms.add(form) } }
        const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') { if (onboarding) { remember(); setOnboarding(false) } else { setOpen(false); setStep(null) } } }
        window.addEventListener('help:open', show)
        window.addEventListener('help:location', sync)
        window.addEventListener('popstate', sync)
        window.addEventListener('keydown', escape)
        document.addEventListener('input', markChanged, true)
        document.addEventListener('change', markChanged, true)
        document.addEventListener('pointerdown', markChanged, true)
        return () => { window.removeEventListener('help:open', show); window.removeEventListener('help:location', sync); window.removeEventListener('popstate', sync); window.removeEventListener('keydown', escape); document.removeEventListener('input', markChanged, true); document.removeEventListener('change', markChanged, true); document.removeEventListener('pointerdown', markChanged, true) }
    }, [onboarding])
    const finish = () => { remember(); setOnboarding(false) }
    const choose = (destination: string) => {
        if (!navigate(destination)) return
        finish(); setOpen(true); setMinimized(false); setStep(0)
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
    return <>
        <PwaInvitation suppressed={onboarding || open} />
        {children}
        {onboarding && <div className="help-welcome-backdrop"><section className="help-welcome" role="dialog" aria-modal="true" aria-labelledby="help-welcome-title">
            <h1 id="help-welcome-title">Що ви хочете зробити?</h1><p>Оберіть напрямок, щоб побачити короткі підказки. Почати можна будь-коли.</p>
            <button type="button" onClick={() => choose('/discover')}><strong>Знайти товар</strong><span>Пошук і мапа товарів поруч</span></button>
            <button type="button" onClick={() => choose('/my/requests/new')}><strong>Створити запит</strong><span>Розкажіть, що шукаєте, а продавці зможуть запропонувати товари</span></button>
            <button type="button" onClick={() => choose('/my/products/new')}><strong>Продати товар</strong><span>Опублікуйте товар або знайдіть запити покупців</span></button>
            <button type="button" className="help-text-button" onClick={finish}>Пропустити вступ</button>
        </section></div>}
        {open && !onboarding && <aside className={'help-panel' + (minimized ? ' help-panel-minimized' : '')} aria-label="Центр допомоги">
            <header><strong>Центр допомоги</strong><div><button type="button" onClick={() => setMinimized(value => !value)}>{minimized ? 'Розгорнути' : 'Згорнути'}</button><button type="button" aria-label="Закрити допомогу" onClick={() => { setOpen(false); setStep(null) }}>×</button></div></header>
            {!minimized && <div className="help-panel-body">
                <button type="button" className="help-text-button" onClick={() => { setOpen(false); setOnboarding(true) }}>Почати вступ знову</button>
                {step === null ? <button type="button" className="help-guide-start" onClick={() => { setTargetMissing(false); setStep(0) }}>Підказки для цієї сторінки</button> : <section className="help-guide" aria-label="Покрокові підказки"><strong>Крок {step + 1} з {steps.length}</strong><p>{steps[step]?.text}</p>{targetMissing && <p role="status">Елемент з’явиться після відкриття відповідного розділу або форми.</p>}<div>{steps[step]?.selector && <button type="button" onClick={showTarget}>Показати елемент</button>}<button type="button" onClick={() => { setTargetMissing(false); setStep(step + 1 < steps.length ? step + 1 : null) }}>{step + 1 < steps.length ? 'Далі / пропустити' : 'Завершити'}</button><button type="button" onClick={() => setStep(null)}>Завершити навчання</button></div></section>}
                <label className="help-search">Пошук у запитаннях<input type="search" value={query} onChange={event => setQuery(event.target.value)} placeholder="Наприклад, доставка" /></label>
                <label className="help-search">Категорія<select value={category} onChange={event => setCategory(event.target.value)}><option>Усі</option>{categories.map(item => <option key={item}>{item}</option>)}</select></label>
                <p className="help-context">Спочатку показано запитання, пов’язані з цією сторінкою.</p>
                {!articles.length && <p>Нічого не знайдено. Спробуйте інші слова або виберіть усі категорії.</p>}
                {articles.map(article => <details key={article.question}><summary>{article.question}</summary><small>{article.category}</small><p>{article.answer}</p><button type="button" className="help-text-button" onClick={() => openLink(article.path)}>{article.link} →</button></details>)}
            </div>}
        </aside>}
    </>
}
