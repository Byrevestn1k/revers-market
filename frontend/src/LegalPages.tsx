import { useEffect, useState, type ReactNode } from 'react'
import { legalDate, legalDocumentForPath, legalDocuments, legalVersion } from './legal-content'
import { CITY_KEY } from './search-location-model'
import './legal.css'

export function SiteFooter({ standalone = false }: { standalone?: boolean }) {
  return <footer className="site-footer" aria-label="Інформація про сервіс">
    <div className="site-footer-columns">
      <div><h2>ДещоТреба</h2><p>Знайдіть те, що потрібно, поруч.</p>
        <a href="/legal/about">Про сервіс</a>
        <a href="/legal/about#how-it-works">Як це працює</a>
        {standalone ? <a href="/?help=1">Центр допомоги</a> : <button type="button" onClick={() => window.dispatchEvent(new Event('help:open'))}>Центр допомоги</button>}
      </div>
      <nav aria-label="Правова інформація"><h2>Правова інформація</h2>
        <a href="/legal/terms">Умови користування</a><a href="/legal/privacy">Конфіденційність</a>
        <a href="/legal/cookies">Cookies та налаштування</a><a href="/legal/listing-rules">Правила оголошень</a>
        <a href="/legal/prohibited">Заборонені товари</a>
      </nav>
      <nav aria-label="Безпека і підтримка"><h2>Безпека і підтримка</h2>
        <a href="/legal/safety#report">Повідомити про порушення</a><a href="/legal/contacts">Контакти</a>
        <a href="/legal/contacts#data-requests">Запити щодо персональних даних</a>
      </nav>
    </div>
    <div className="site-footer-bottom"><span>© {new Date().getFullYear()} ДещоТреба</span><span>Тестовий MVP · правові документи — проєкти</span></div>
  </footer>
}

function StorageSettings() {
  const [message, setMessage] = useState('')
  const clearPreferences = () => {
    try {
      for (const key of [CITY_KEY, 'productDisplayCurrency', 'notificationContext']) localStorage.removeItem(key)
      sessionStorage.removeItem('discoverMapState')
      setMessage('Налаштування пошуку, валюти й контексту сповіщень на цьому пристрої очищено. Відкриті вкладки можуть зберігати власний стан до перезавантаження.')
    } catch { setMessage('Браузер не дозволив очистити сховище. Скористайтеся налаштуваннями даних сайту в браузері.') }
  }
  return <section className="legal-settings" aria-labelledby="storage-settings-title" id="settings">
    <h2 id="storage-settings-title">Керування на цьому пристрої</h2>
    <p>Аналітика та маркетингове відстеження в коді не підключені. Пошукові налаштування можна стерти без видалення акаунта, чернеток або налаштувань push.</p>
    <button className="outline-button" type="button" onClick={clearPreferences}>Очистити збережені налаштування пошуку</button>
    <p role="status">{message}</p>
    <p>Push можна вимкнути в <a href="/settings/profile">налаштуваннях профілю</a>. Дозволи на сповіщення й геолокацію змінюються також у налаштуваннях сайту вашого браузера. Очищення пошуку їх не відкликає.</p>
  </section>
}

function LegalPage({ path }: { path: string }) {
  const document = legalDocumentForPath(path)
  useEffect(() => {
    const previous = window.document.title
    window.document.title = `${document?.title ?? 'Правова інформація'} — ДещоТреба`
    const anchor = window.location.hash.slice(1)
    if (anchor) window.document.getElementById(anchor)?.scrollIntoView()
    return () => { window.document.title = previous }
  }, [document])
  return <div className="legal-shell">
    <a className="legal-skip" href="#legal-main">Перейти до змісту</a>
    <header className="legal-header"><a href="/"><img src="/brand/logo-full.png" alt="ДещоТреба — на головну" /></a><a href="/">До оголошень →</a></header>
    <main className="legal-main" id="legal-main">
      <nav className="legal-breadcrumbs" aria-label="Навігаційний шлях"><a href="/">Головна</a><span aria-hidden="true">/</span><span>Правова інформація</span></nav>
      <aside className="legal-draft" aria-label="Статус документів"><strong>Проєкт для перевірки · не остаточні умови</strong><p>Оператор, контакти та production-провайдери ще не визначені. Документи не погоджені юристом і не готові для публічного запуску. Ця сторінка не збирає прийняття умов або згоду.</p></aside>
      <div className="legal-layout"><nav className="legal-menu" aria-label="Юридичні документи">{legalDocuments.map(item => <a key={item.slug} href={`/legal/${item.slug}`} aria-current={document?.slug === item.slug ? 'page' : undefined}>{item.title}</a>)}</nav>
        <article className="legal-article"><p className="legal-version">Проєкт від {legalDate} · {legalVersion}</p>
          <h1>{document?.title ?? 'Сторінку не знайдено'}</h1>
          {!document ? <p>Оберіть документ у меню.</p> : <><p className="legal-summary">{document.summary}</p>
            <nav className="legal-toc" aria-label="Зміст документа">{document.sections.map(section => <a href={`#${section.id}`} key={section.id}>{section.title}</a>)}</nav>
            {document.sections.map(section => <section id={section.id} key={section.id}><h2>{section.title}</h2>{section.paragraphs.map((text, index) => <p key={index}>{text}</p>)}{section.items && <ul>{section.items.map(item => <li key={item}>{item}</li>)}</ul>}</section>)}
            {document.slug === 'cookies' && <StorageSettings />}
            <p className="legal-related">Дивіться також: <a href="/legal/privacy">конфіденційність</a> та <a href="/legal/contacts#data-requests">звернення щодо даних</a>.</p>
          </>}
        </article>
      </div>
    </main>
    <SiteFooter standalone />
    <nav className="legal-mobile-nav" aria-label="Основна навігація">{[['/', '⌕', 'Знайти'], ['/favorites', '♡', 'Обране'], ['/my/products/new', '＋', 'Додати'], ['/messages', '♧', 'Чати'], ['/cabinet', '♙', 'Кабінет']].map(([href, icon, label]) => <a href={href} key={href}><span aria-hidden="true">{icon}</span>{label}</a>)}</nav>
  </div>
}

// Keep public documents outside auth, catalog loading and onboarding overlays.
export function LegalBoundary({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname)
  useEffect(() => {
    const sync = () => setPath(window.location.pathname)
    window.addEventListener('popstate', sync)
    window.addEventListener('help:location', sync)
    return () => { window.removeEventListener('popstate', sync); window.removeEventListener('help:location', sync) }
  }, [])
  return path === '/legal' || path.startsWith('/legal/') ? <LegalPage path={path} /> : children
}

// An entry link from standalone pages opens the existing Help Center through its event API.
export function LegalHelpEntry() {
  useEffect(() => {
    const url = new URL(window.location.href)
    if (url.searchParams.get('help') !== '1') return
    const timer = window.setTimeout(() => {
      const current = new URL(window.location.href)
      current.searchParams.delete('help')
      window.history.replaceState(window.history.state, '', current.pathname + current.search + current.hash)
      window.dispatchEvent(new Event('help:open'))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])
  return null
}
