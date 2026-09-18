import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Product, User } from './App'
import { CategoryImage } from './CategoryPicker'
import ProductCard from './ProductCard'
import type { MapResults } from './map-sellers'
import { categoryChildren, categoryTrail } from './categories'
import type { Category } from './categories'
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

function savedCity(): HomeCity {
    try {
        const stored = JSON.parse(localStorage.getItem(CITY_KEY) || 'null') as HomeCity | null
        return CITIES.find((item) => item.name === stored?.name) || CITIES[0]
    } catch { return CITIES[0] }
}

export type HomeMapProps = {
    city: HomeCity
    sharedCategoryId: string
    onCategoryChange: (id: string) => void
    onResultsChange: (results: MapResults) => void
    locationControls: ReactNode
}
type Props = {
    categories: Category[]
    request: (path: string, options?: RequestInit) => Promise<any>
    user: User | null
    onAccount: () => void
    onCreate: () => void
    openProduct: (product: Product) => void
    renderMap: (props: HomeMapProps) => ReactNode
}
export default function PublicHome({ categories, request, user, onAccount, onCreate, openProduct, renderMap }: Props) {
    const [city, setCity] = useState(savedCity)
    const [categoryId, setCategoryId] = useState('')
    const [results, setResults] = useState<MapResults>({ markers: [], loading: true, error: '', query: '', scope: '' })
    const [page, setPage] = useState(1)
    const [locationMessage, setLocationMessage] = useState('')
    const [locating, setLocating] = useState(false)
    const [openError, setOpenError] = useState('')
    const openVersion = useRef(0)
    const products = useMemo(() => results.markers.filter((item) => item.kind === 'product'), [results.markers])
    const pages = Math.max(1, Math.ceil(products.length / 12))
    const activePage = Math.min(page, pages)
    useEffect(() => { try { localStorage.setItem(CITY_KEY, JSON.stringify(city)) } catch { /* Storage is optional. */ } }, [city])
    useEffect(() => { setPage(1); setOpenError('') }, [results.markers])
    useEffect(() => () => { openVersion.current++ }, [])
    const chooseCity = (value: HomeCity) => { setCity(value); setLocationMessage('') }
    const selectedRootId = categoryTrail(categories, categoryId)[0]?.id
    const locate = () => {
        if (!navigator.geolocation) { setLocationMessage('Оберіть місто вручну — визначення місця недоступне.'); return }
        setLocating(true); setLocationMessage('')
        navigator.geolocation.getCurrentPosition((position) => {
            const { latitude, longitude } = position.coords
            const distance = (item: HomeCity) => (item.latitude - latitude) ** 2 + ((item.longitude - longitude) * Math.cos(latitude * Math.PI / 180)) ** 2
            const nearest = CITIES.reduce((best, item) => distance(item) < distance(best) ? item : best)
            chooseCity(nearest); setLocating(false); setLocationMessage('Найближче місто: ' + nearest.name)
        }, () => { setLocating(false); setLocationMessage('Не вдалося визначити місце. Оберіть місто вручну.') }, { enableHighAccuracy: false, maximumAge: 300000, timeout: 10000 })
    }
    const open = async (id: string) => {
        const version = ++openVersion.current
        setOpenError('')
        try { const result = await request('/api/products/' + id); if (version === openVersion.current) openProduct(result.product) }
        catch (error) { if (version === openVersion.current) setOpenError((error as Error).message) }
    }
    const locationControls = <div className="map-city-controls">
        <label>Місто пошуку<select value={city.name} onChange={(event) => chooseCity(CITIES.find((item) => item.name === event.target.value)!)}>{CITIES.map((item) => <option key={item.name}>{item.name}</option>)}</select></label>
        <button type="button" className="outline-button" onClick={locate} disabled={locating}>{locating ? 'Визначаємо…' : '⌖ Моє місце'}</button>
        {locationMessage && <small role="status">{locationMessage}</small>}
    </div>
    return <div className="public-home">
        <header className="market-header"><div className="market-header-inner">
            <a className="market-logo" href="/" aria-label="ДещоТреба — головна"><img className="market-logo-full" src="/brand/logo-full.png" alt="ДещоТреба" /><img className="market-logo-mini" src="/brand/logo-mini.png" alt="ДещоТреба" /></a>
            <span className="market-language" aria-label="Мова: українська. Інші мови незабаром" title="Інші мови незабаром">Укр <span aria-hidden="true">⌄</span></span>
            <button className="market-account" onClick={onAccount}><span aria-hidden="true">♙</span>{user ? 'Мій профіль' : 'Зареєструватися / Увійти'}</button>
            <button className="market-add" onClick={onCreate}>＋ Додати пропозицію</button>
        </div></header>
        <main className="market-main">
            <section className="market-search-section" aria-labelledby="market-title"><span className="eyebrow">Поруч і для тебе</span><h1 id="market-title">Знайдіть те, що потрібно, поруч</h1></section>
            <section className="market-map" aria-label="Єдиний пошук на мапі">{renderMap({ city, sharedCategoryId: categoryId, onCategoryChange: setCategoryId, onResultsChange: setResults, locationControls })}</section>
            <details className="market-categories"><summary>Усі категорії</summary><div className="market-category-grid">{categoryChildren(categories, null).map((category) => <button type="button" className={'market-category ' + (selectedRootId === category.id ? 'is-selected' : '')} key={category.id} onClick={() => setCategoryId(category.id)} aria-pressed={selectedRootId === category.id}><CategoryImage category={category} /><strong>{category.name}</strong></button>)}</div></details>
            <section className="market-results" aria-labelledby="results-title" aria-busy={results.loading}>
                <div className="market-section-title"><h2 id="results-title">{results.query ? 'Результати для «' + results.query + '»' : 'Товари у видимій області'}{results.scope ? ' · ' + results.scope : ''}</h2><span>{products.length} товарів</span></div>
                <p className="market-results-note">Ті самі товари, що й на мапі. Перемістіть мапу або змініть фільтри, щоб оновити список.</p>
                {openError && <p role="alert" className="form-error">{openError}</p>}
                {results.loading ? <p role="status" className="market-empty">Шукаємо пропозиції…</p> : results.error ? <p role="alert" className="market-empty">{results.error}</p> : products.length ? <div className="product-grid">{products.slice((activePage - 1) * 12, activePage * 12).map((product) => <ProductCard key={product.id} product={product} onOpen={() => open(product.id)} />)}</div> : <p className="market-empty">{results.markers.length ? 'На мапі є запити покупців. Відкрийте їхні точки або увімкніть продавців.' : 'За цим пошуком у видимій області товарів немає. Змініть назву, категорію або перемістіть мапу.'}</p>}
                {pages > 1 && <nav className="pagination" aria-label="Сторінки пошуку"><button disabled={activePage === 1 || results.loading} onClick={() => setPage(activePage - 1)}>←</button><span>{activePage} / {pages}</span><button disabled={activePage === pages || results.loading} onClick={() => setPage(activePage + 1)}>→</button></nav>}
            </section>
        </main>
        <footer className="market-footer">ДещоТреба · Поруч і для тебе</footer>
    </div>
}
