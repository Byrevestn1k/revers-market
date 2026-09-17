import { useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import type { Product, User } from './App'
import './public-home.css'

export type HomeCity = { name: string; latitude: number; longitude: number }
const CITY_KEY = 'deshchotreba.home-city'
const CITIES: HomeCity[] = [
    { name: 'Київ', latitude: 50.45, longitude: 30.52 },
    { name: 'Рівне', latitude: 50.62, longitude: 26.25 },
    { name: 'Львів', latitude: 49.84, longitude: 24.03 },
    { name: 'Луцьк', latitude: 50.75, longitude: 25.34 },
    { name: 'Тернопіль', latitude: 49.55, longitude: 25.59 },
    { name: 'Івано-Франківськ', latitude: 48.92, longitude: 24.71 },
    { name: 'Ужгород', latitude: 48.62, longitude: 22.30 },
    { name: 'Чернівці', latitude: 48.29, longitude: 25.94 },
    { name: 'Хмельницький', latitude: 49.42, longitude: 26.99 },
    { name: 'Житомир', latitude: 50.25, longitude: 28.66 },
    { name: 'Вінниця', latitude: 49.23, longitude: 28.47 },
    { name: 'Одеса', latitude: 46.48, longitude: 30.72 },
    { name: 'Миколаїв', latitude: 46.98, longitude: 31.99 },
    { name: 'Херсон', latitude: 46.64, longitude: 32.62 },
    { name: 'Дніпро', latitude: 48.46, longitude: 35.05 },
    { name: 'Запоріжжя', latitude: 47.84, longitude: 35.14 },
    { name: 'Харків', latitude: 49.99, longitude: 36.23 },
    { name: 'Полтава', latitude: 49.59, longitude: 34.55 },
    { name: 'Суми', latitude: 50.91, longitude: 34.80 },
    { name: 'Чернігів', latitude: 51.50, longitude: 31.29 },
    { name: 'Черкаси', latitude: 49.44, longitude: 32.06 },
    { name: 'Кропивницький', latitude: 48.51, longitude: 32.26 },
    { name: 'Донецьк', latitude: 48.02, longitude: 37.80 },
    { name: 'Луганськ', latitude: 48.57, longitude: 39.31 },
    { name: 'Сімферополь', latitude: 44.95, longitude: 34.10 },
    { name: 'Кривий Ріг', latitude: 47.91, longitude: 33.39 },
    { name: 'Млинів', latitude: 50.51, longitude: 25.62 },
]
const POPULAR = [
    ['⌂', 'Нерухомість'], ['🚗', 'Транспорт'], ['💼', 'Робота'],
    ['🛠', 'Послуги'], ['📱', 'Електроніка'], ['🛋', 'Дім і сад'],
    ['👕', 'Одяг і взуття'], ['🧸', 'Дитячі товари'], ['🐾', 'Тварини'],
    ['🌾', 'Продукти та господарство'],
]

function savedCity(): HomeCity {
    try {
        const stored = JSON.parse(localStorage.getItem(CITY_KEY) || 'null') as HomeCity | null
        return CITIES.find((item) => item.name === stored?.name) || CITIES[0]
    } catch { return CITIES[0] }
}

type Props = {
    request: (path: string, options?: RequestInit) => Promise<any>
    user: User | null
    onAccount: () => void
    onCreate: () => void
    openProduct: (product: Product) => void
    renderMap: (city: HomeCity) => ReactNode
}

export default function PublicHome({ request, user, onAccount, onCreate, openProduct, renderMap }: Props) {
    const [city, setCity] = useState(savedCity)
    const [query, setQuery] = useState('')
    const [submittedQuery, setSubmittedQuery] = useState('')
    const [page, setPage] = useState(1)
    const [pages, setPages] = useState(0)
    const [products, setProducts] = useState<Product[]>([])
    const [busy, setBusy] = useState(true)
    const [error, setError] = useState('')
    const [locationMessage, setLocationMessage] = useState('')
    const [locating, setLocating] = useState(false)

    useEffect(() => {
        try { localStorage.setItem(CITY_KEY, JSON.stringify(city)) } catch { /* Browsing still works without storage. */ }
    }, [city])

    useEffect(() => {
        const controller = new AbortController()
        setBusy(true); setError('')
        const params = new URLSearchParams({ page: String(page), limit: '12', geoZone: `%${city.name}%` })
        if (submittedQuery) params.set('q', submittedQuery)
        request(`/api/products?${params}`, { signal: controller.signal }).then((result) => {
            if (!controller.signal.aborted) { setProducts(result.products); setPages(result.pagination.pages) }
        }).catch((caught: Error) => {
            if (!controller.signal.aborted) { setError(caught.message); setProducts([]); setPages(0) }
        }).finally(() => { if (!controller.signal.aborted) setBusy(false) })
        return () => controller.abort()
    }, [city, submittedQuery, page, request])

    const chooseCity = (value: HomeCity) => { setCity(value); setPage(1); setLocationMessage('') }
    const search = (event: FormEvent) => { event.preventDefault(); setSubmittedQuery(query.trim()); setPage(1) }
    const locate = () => {
        if (!navigator.geolocation) { setLocationMessage('Оберіть місто вручну — визначення місця недоступне.'); return }
        setLocating(true); setLocationMessage('')
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords
            const distance = (item: HomeCity) => (item.latitude - latitude) ** 2 + ((item.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) ** 2
            const nearest = CITIES.reduce((best, item) => distance(item) < distance(best) ? item : best)
            chooseCity(nearest); setLocating(false)
            setLocationMessage(`Найближче місто зі списку: ${nearest.name}. За потреби змініть його вручну.`)
        }, () => {
            setLocating(false); setLocationMessage('Не вдалося визначити місце. Оберіть місто вручну.')
        }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 })
    }

    return <div className="public-home">
        <header className="market-header">
            <div className="market-header-inner">
                <a className="market-logo" href="/" aria-label="ДещоТреба — головна">
                    <img className="market-logo-full" src="/brand/logo-full.png" alt="ДещоТреба" />
                    <img className="market-logo-mini" src="/brand/logo-mini.png" alt="ДещоТреба" />
                </a>
                <span className="market-language" aria-label="Мова: українська. Інші мови незабаром" title="Інші мови незабаром">Укр <span aria-hidden="true">⌄</span></span>
                <button className="market-account" onClick={onAccount}><span aria-hidden="true">♙</span>{user ? 'Мій профіль' : 'Зареєструватися / Увійти'}</button>
                <button className="market-add" onClick={onCreate}>＋ Додати пропозицію</button>
            </div>
        </header>
        <main className="market-main">
            <section className="market-search-section" aria-labelledby="market-title">
                <span className="eyebrow">Поруч і для тебе</span>
                <h1 id="market-title">Знайдіть те, що потрібно, поруч</h1>
                <form className="market-search" onSubmit={search}>
                    <label className="market-query"><span aria-hidden="true">⌕</span><span className="visually-hidden">Що шукаєте?</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Що шукаєте?" maxLength={160} /></label>
                    <label className="market-city"><span aria-hidden="true">⌖</span><span className="visually-hidden">Місто пошуку</span><select value={city.name} onChange={(event) => chooseCity(CITIES.find((item) => item.name === event.target.value)!)}>{CITIES.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
                    <button className="market-search-button" type="submit">Пошук <span aria-hidden="true">⌕</span></button>
                </form>
                <div className="market-location"><button type="button" onClick={locate} disabled={locating}>{locating ? 'Визначаємо місце…' : '⌖ Моє місце'}</button><span role="status">{locationMessage || 'Місто запам’ятовується на цьому пристрої.'}</span></div>
            </section>
            <section className="market-categories" aria-labelledby="category-title">
                <div className="market-section-title"><h2 id="category-title">Популярні категорії</h2><span>Незабаром</span></div>
                <div className="market-category-grid">{POPULAR.map(([icon, name]) => <div className="market-category" key={name}><span className="market-category-icon" aria-hidden="true">{icon}</span><strong>{name}</strong></div>)}</div>
            </section>
            <section className="market-map" aria-labelledby="city-map-title"><div className="market-section-title"><div><span className="eyebrow">Досліджуйте поруч</span><h2 id="city-map-title">Пропозиції на мапі · {city.name}</h2></div></div>{renderMap(city)}</section>
            <section className="market-results" aria-labelledby="results-title" aria-busy={busy}>
                <div className="market-section-title"><h2 id="results-title">{submittedQuery ? `Результати для «${submittedQuery}»` : 'Пропозиції поруч'} · {city.name}</h2></div>
                {busy ? <p role="status" className="market-empty">Шукаємо пропозиції…</p> : error ? <p role="alert" className="market-empty">{error}</p> : products.length ? <div className="product-grid">{products.map((product) => <button className="market-product" key={product.id} onClick={() => openProduct(product)}>{product.photos[0]?.url ? <img src={product.photos[0].url.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${product.photos[0].url}` : product.photos[0].url} alt={product.photos[0].alt || product.title} loading="lazy" /> : <div className="market-product-placeholder" aria-hidden="true">▧</div>}<div><small>{product.category.name}</small><h3>{product.title}</h3><strong>{new Intl.NumberFormat('uk-UA').format(product.price.amount)} {product.price.currency}</strong><p>{product.geoZone}</p></div></button>)}</div> : <p className="market-empty">У цьому місті пропозицій поки немає. Спробуйте інше місто або змініть запит.</p>}
                {pages > 1 && <nav className="pagination" aria-label="Сторінки пошуку"><button disabled={page === 1 || busy} onClick={() => setPage(page - 1)}>←</button><span>{page} / {pages}</span><button disabled={page === pages || busy} onClick={() => setPage(page + 1)}>→</button></nav>}
            </section>
        </main>
        <footer className="market-footer">ДещоТреба · Поруч і для тебе</footer>
    </div>
}
