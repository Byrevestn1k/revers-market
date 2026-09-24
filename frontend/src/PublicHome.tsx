import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Product, User } from './App'
import { CategoryImage } from './CategoryPicker'
import ProductCard from './ProductCard'
import type { MapResults } from './map-sellers'
import { categoryChildren, categoryTrail } from './categories'
import type { Category } from './categories'
import './public-home.css'

export type { HomeCity } from './search-location-model'

export type HomeMapProps = {
    userId?: string
    locationReady?: boolean
    sharedCategoryId: string
    onCategoryChange: (id: string) => void
    onResultsChange: (results: MapResults) => void
}
type Props = {
    locationReady?: boolean
    categories: Category[]
    request: (path: string, options?: RequestInit) => Promise<any>
    user: User | null
    onAccount: () => void
    onCreate: () => void
    openProduct: (product: Product) => void
    renderMap: (props: HomeMapProps) => ReactNode
}
export default function PublicHome({ categories, request, user, onAccount, onCreate, openProduct, renderMap, locationReady = true }: Props) {
    const [categoryId, setCategoryId] = useState('')
    const [results, setResults] = useState<MapResults>({ markers: [], loading: true, error: '', query: '', scope: '' })
    const [nationalCategoryCounts, setNationalCategoryCounts] = useState<Map<string, number>>(new Map())
    const [page, setPage] = useState(1)
    const [openError, setOpenError] = useState('')
    const openVersion = useRef(0)
    const categoryRail = useRef<HTMLDivElement>(null)
    const products = useMemo(() => results.markers.filter((item) => item.kind === 'product'), [results.markers])
    useEffect(() => {
        let active = true
        request('/api/categories/popular').then(result => {
            if (active) setNationalCategoryCounts(new Map((result.categoryCounts ?? []).map((item: { categoryId: string; count: number }) => [item.categoryId, item.count])))
        }).catch(() => { /* The category row still works alphabetically if statistics are temporarily unavailable. */ })
        return () => { active = false }
    }, [request])
    const popularCategories = useMemo(() => {
        const counts = new Map<string, number>()
        if (results.markers.length) {
            for (const marker of results.markers) {
                const root = categoryTrail(categories, marker.category.id)[0]
                if (root) counts.set(root.id, (counts.get(root.id) ?? 0) + 1)
            }
        } else {
            for (const [categoryId, count] of nationalCategoryCounts) counts.set(categoryId, count)
        }
        return categoryChildren(categories, null).map(category => ({ category, count: counts.get(category.id) ?? 0 })).sort((a, b) => b.count - a.count || a.category.name.localeCompare(b.category.name, 'uk'))
    }, [categories, nationalCategoryCounts, results.markers])
    const pages = Math.max(1, Math.ceil(products.length / 12))
    const activePage = Math.min(page, pages)
    useEffect(() => { setPage(1); setOpenError('') }, [results.markers])
    useEffect(() => () => { openVersion.current++ }, [])
    const open = async (id: string) => {
        const version = ++openVersion.current
        setOpenError('')
        try { const result = await request('/api/products/' + id); if (version === openVersion.current) openProduct(result.product) }
        catch (error) { if (version === openVersion.current) setOpenError((error as Error).message) }
    }
    return <div className="public-home">
        <header className="market-header"><div className="market-header-inner">
            <a className="market-logo" href="/" aria-label="ДещоТреба — головна"><img className="market-logo-full" src="/brand/logo-full.png" alt="ДещоТреба" /><img className="market-logo-mini" src="/brand/logo-mini.png" alt="ДещоТреба" /></a>
            <span className="market-language" aria-label="Мова: українська. Інші мови незабаром" title="Інші мови незабаром">Укр <span aria-hidden="true">⌄</span></span>
            <button className="market-account" onClick={onAccount}><span aria-hidden="true">♙</span>{user ? 'Мій профіль' : 'Зареєструватися / Увійти'}</button>
            <button className="market-add" onClick={onCreate}>＋ Додати пропозицію</button>
        </div></header>
        <main className="market-main">
            <section className="market-search-section" aria-labelledby="market-title"><span className="eyebrow">Поруч і для тебе</span><h1 id="market-title">Знайдіть те, що потрібно, поруч</h1></section>
            <section className="market-map" aria-label="Єдиний пошук на мапі">{renderMap({ userId: user?.id, locationReady, sharedCategoryId: categoryId, onCategoryChange: setCategoryId, onResultsChange: setResults })}</section>
            <section className="market-categories" aria-label="Популярні категорії"><div className="market-category-heading"><h2>Популярні категорії</h2></div><div className="market-category-carousel"><button type="button" className="market-category-scroll market-category-scroll-prev" onClick={() => categoryRail.current?.scrollBy({ left: -Math.max(260, categoryRail.current.clientWidth - 120), behavior: 'smooth' })} aria-label="Попередні категорії"><span aria-hidden="true">‹</span></button><div className="market-category-rail" ref={categoryRail}>{popularCategories.map(({ category, count }) => <button type="button" className={categoryTrail(categories, categoryId)[0]?.id === category.id ? 'is-selected' : ''} key={category.id} onClick={() => setCategoryId(category.id)}><CategoryImage category={category} /><span>{category.name}</span>{count > 0 && <small>{count}</small>}</button>)}</div><button type="button" className="market-category-scroll market-category-scroll-next" onClick={() => categoryRail.current?.scrollBy({ left: Math.max(260, categoryRail.current.clientWidth - 120), behavior: 'smooth' })} aria-label="Наступні категорії"><span aria-hidden="true">›</span></button></div></section>
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
