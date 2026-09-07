import { FormEvent, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'

type User = { id: string; username: string; countryCode: string; phone: string }
type Category = { id: string; code?: string; name: string; path?: string }
type Product = { id: string; title: string; description: string; photos: { url: string; alt: string }[]; quantity: number; unit: string; price: { amount: number; currency: string }; deliveryMode: string; geoZone: string; status: string; owner: { id: string }; category: { id: string; name: string } }
type View = 'home' | 'products' | 'map' | 'mine' | 'create' | 'request' | 'profile'
type MapPoint = { latitude: number; longitude: number }
type MapMarker = MapPoint & { id: string; kind: 'product' | 'buyRequest'; title: string; geoZone: string; category: { id: string; name: string }; approximate: true; distanceKm: number }
type BuyRequest = { id: string; title: string; description: string; geoArea: string; category: { name: string }; quantity: number; unit: string; status: string; coordinates: MapPoint | null }
type ApiError = Error & { fields?: string[] }
const API = import.meta.env.VITE_API_URL ?? 'http://127.0.0.1:3000'
const FALLBACK = 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?auto=format&fit=crop&w=900&q=80'
const STATUS: Record<string, string> = { draft: 'Чернетка', active: 'Активний', paused: 'Призупинений', sold: 'Проданий', expired: 'Завершений' }
const imageUrl = (url: string) => url.startsWith('/') ? `${API}${url}` : url

async function request(path: string, options?: RequestInit) {
    const response = await fetch(`${API}${path}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options?.headers } })
    const body = response.status === 204 ? null : await response.json()
    if (!response.ok) { const error = new Error(body?.message ?? 'Не вдалося виконати запит') as ApiError; error.fields = body?.fields ?? []; throw error }
    return body
}
const formatPrice = (amount: number, currency: string) => `${new Intl.NumberFormat('uk-UA').format(amount)} ${currency}`

function Auth({ onLogin }: { onLogin: (user: User) => void }) {
    const [register, setRegister] = useState(false)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('')
        const data = Object.fromEntries(new FormData(event.currentTarget).entries())
        if (register) data.countryCode = 'UA'
        try { const result = await request(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(data) }); onLogin(result.user) }
        catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
    }
    return <main className="auth-page"><div className="auth-story"><div className="brand"><span className="brand-mark">N</span> Навпаки</div><span className="eyebrow">Маркетплейс поруч</span><h1>Продавайте те,<br /><em>що росте.</em></h1><p>Агропродукція від своїх. Чесно, локально, без зайвих кроків.</p></div><section className="auth-card"><span className="eyebrow">Ласкаво просимо</span><h2>{register ? 'Створіть акаунт' : 'З поверненням'}</h2><p>{register ? 'Почніть продавати врожай поруч.' : 'Увійдіть, щоб керувати товарами.'}</p><div className="auth-tabs"><button className={!register ? 'selected' : ''} onClick={() => setRegister(false)}>Увійти</button><button className={register ? 'selected' : ''} onClick={() => setRegister(true)}>Реєстрація</button></div><form onSubmit={submit}><label>Ім’я користувача<input name="username" required /></label>{register && <label>Телефон<input name="phone" required /></label>}<label>Пароль<input name="password" type="password" required /></label>{register && <label>Підтвердження пароля<input name="passwordConfirmation" type="password" required /></label>}{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Зачекайте...' : register ? 'Створити акаунт' : 'Увійти в акаунт'} <span>→</span></button></form></section></main>
}

function Card({ product, onOpen, onEdit, onDelete }: { product: Product; onOpen: () => void; onEdit?: () => void; onDelete?: () => void }) {
    return <article className="product-card" onClick={onOpen}><div className="product-image"><img src={imageUrl(product.photos[0]?.url || FALLBACK)} alt={product.photos[0]?.alt || product.title} /><span className={`status status-${product.status}`}>{STATUS[product.status]}</span>{onEdit && <button className="card-edit" onClick={(event) => { event.stopPropagation(); onEdit() }}>•••</button>}{onDelete && <button className="card-delete" onClick={(event) => { event.stopPropagation(); onDelete() }}>×</button>}</div><div className="product-card-body"><div className="product-card-title"><h3>{product.title}</h3><span className="heart">♡</span></div><strong className="price">{formatPrice(product.price.amount, product.price.currency)} <small>/ {product.unit}</small></strong><p><span>⌖</span> {product.geoZone}</p><div className="card-meta"><span>{product.quantity} {product.unit}</span><span>{product.category.name}</span></div></div></article>
}
function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><span>✦</span><h3>{text}</h3>{action && <button className="primary-button compact" onClick={onAction}>{action}</button>}</div> }
function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) { return pages > 1 ? <div className="pagination"><button disabled={page === 1} onClick={() => onPage(page - 1)}>←</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => onPage(page + 1)}>→</button></div> : null }

function ProductDetail({ product, close, owner, edit }: { product: Product; close: () => void; owner: boolean; edit: () => void }) {
    return <div className="modal-backdrop" onClick={close}><section className="detail-modal" onClick={(event) => event.stopPropagation()}><button className="modal-close" onClick={close}>×</button><img className="detail-image" src={imageUrl(product.photos[0]?.url || FALLBACK)} alt={product.title} /><div className="detail-body"><span className={`status status-${product.status}`}>{STATUS[product.status]}</span><span className="eyebrow">{product.category.name}</span><h2>{product.title}</h2><strong className="detail-price">{formatPrice(product.price.amount, product.price.currency)} <small>/ {product.unit}</small></strong><p className="detail-description">{product.description || 'Опис товару ще не додано.'}</p><div className="detail-facts"><span>⌖ <b>{product.geoZone}</b><small>Місце</small></span><span>▧ <b>{product.quantity} {product.unit}</b><small>Кількість</small></span><span>♧ <b>{product.deliveryMode}</b><small>Доставка</small></span></div>{owner && <button className="primary-button" onClick={edit}>Редагувати товар <span>→</span></button>}</div></section></div>
}

function MapView({ categories, openProduct, notify }: { categories: Category[]; openProduct: (product: Product) => void; notify: (message: string) => void }) {
    const mapElement = useRef<HTMLDivElement>(null)
    const mapInstance = useRef<L.Map | null>(null)
    const markerLayer = useRef<L.LayerGroup | null>(null)
    const [center, setCenter] = useState<MapPoint>({ latitude: 50.45, longitude: 30.52 })
    const [radius, setRadius] = useState(25)
    const [zoom, setZoom] = useState(10)
    const [geoZone, setGeoZone] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [showProducts, setShowProducts] = useState(true)
    const [showBuyRequests, setShowBuyRequests] = useState(true)
    const [markers, setMarkers] = useState<MapMarker[]>([])
    const [selectedRequest, setSelectedRequest] = useState<BuyRequest | null>(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')

    const loadMarkers = async () => {
        setLoading(true); setError('')
        const params = new URLSearchParams({ latitude: String(center.latitude), longitude: String(center.longitude), radiusKm: String(radius), zoom: String(zoom), showProducts: String(showProducts), showBuyRequests: String(showBuyRequests) })
        if (geoZone.trim()) params.set('geoZone', geoZone.trim())
        if (categoryId) params.set('categoryId', categoryId)
        try { setMarkers((await request(`/api/map/markers?${params}`)).markers) }
        catch (caught) { setError((caught as Error).message); setMarkers([]) }
        finally { setLoading(false) }
    }

    useEffect(() => { loadMarkers() }, [center.latitude, center.longitude, radius, zoom, showProducts, showBuyRequests, categoryId, geoZone])

    useEffect(() => {
        if (!mapElement.current || mapInstance.current) return
        const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true }).setView([center.latitude, center.longitude], zoom)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
        markerLayer.current = L.layerGroup().addTo(map)
        map.on('moveend', () => {
            const nextCenter = map.getCenter()
            const nextZoom = map.getZoom()
            setCenter({ latitude: Number(nextCenter.lat.toFixed(5)), longitude: Number(nextCenter.lng.toFixed(5)) })
            setZoom(nextZoom)
        })
        mapInstance.current = map
        return () => { map.remove(); mapInstance.current = null; markerLayer.current = null }
    }, [])

    useEffect(() => {
        const map = mapInstance.current
        if (!map) return
        const current = map.getCenter()
        if (Math.abs(current.lat - center.latitude) > 0.00001 || Math.abs(current.lng - center.longitude) > 0.00001 || map.getZoom() !== zoom) {
            map.setView([center.latitude, center.longitude], zoom)
        }
    }, [center.latitude, center.longitude, zoom])

    useEffect(() => {
        if (!markerLayer.current) return
        markerLayer.current.clearLayers()
        markers.forEach((marker) => {
            const color = marker.kind === 'product' ? '#16a05a' : '#d47e4b'
            const leafletMarker = L.circleMarker([marker.latitude, marker.longitude], { radius: 9, color, fillColor: color, fillOpacity: .9, weight: 3 })
            leafletMarker.bindTooltip(`${marker.title} · ${marker.distanceKm} км`)
            leafletMarker.on('click', () => openMarker(marker))
            leafletMarker.addTo(markerLayer.current!)
        })
    }, [markers])

    const useMyLocation = () => navigator.geolocation.getCurrentPosition(
        (position) => setCenter({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        () => notify('Не вдалося отримати ваше місцезнаходження'),
        { enableHighAccuracy: false, maximumAge: 300000 },
    )
    const openMarker = async (marker: MapMarker) => {
        try {
            if (marker.kind === 'product') openProduct((await request(`/api/products/${marker.id}`)).product)
            else setSelectedRequest((await request(`/api/buy-requests/${marker.id}`)).buyRequest)
        } catch (caught) { notify((caught as Error).message) }
    }
    const project = (point: MapPoint) => ({ left: `${Math.min(94, Math.max(6, 50 + (point.longitude - center.longitude) * 7 * (zoom / 10)))}%`, top: `${Math.min(88, Math.max(10, 50 - (point.latitude - center.latitude) * 7 * (zoom / 10)))}%` })

    return <section className="content map-view"><div className="view-header"><div><span className="eyebrow">Орієнтир</span><h1>Мапа поруч</h1><p className="view-subtitle">Показуємо приблизні точки, без домашніх адрес.</p></div><button className="outline-button" onClick={useMyLocation}>⌖ Моє місце</button></div><div className="map-toolbar"><label>Радіус <strong>{radius} км</strong><input type="range" min="1" max="200" step="1" value={radius} onChange={(event) => setRadius(Number(event.target.value))} /></label><label>Категорія<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Усі категорії</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><label>Місце<input value={geoZone} onChange={(event) => setGeoZone(event.target.value)} placeholder="Область або місто" /></label><label>Масштаб <strong>{zoom}</strong><input type="range" min="3" max="19" step="1" value={zoom} onChange={(event) => setZoom(Number(event.target.value))} /></label><div className="map-toggles"><label><input type="checkbox" checked={showProducts} onChange={(event) => setShowProducts(event.target.checked)} /> Продавці</label><label><input type="checkbox" checked={showBuyRequests} onChange={(event) => setShowBuyRequests(event.target.checked)} /> Запити</label></div></div><div className="map-layout"><div ref={mapElement} className="map-canvas" aria-label="Мапа товарів та запитів">{loading && <span className="map-status">Оновлення…</span>}{!loading && !markers.length && <span className="map-status">У цьому радіусі немає точок</span>}</div><aside className="map-summary"><span className="eyebrow">Результати</span><h2>{markers.length} точок</h2><p>Точки округлені для приватності. Натисніть маркер або рядок, щоб відкрити деталі.</p><div className="map-result-list">{markers.map((marker) => <button key={`result-${marker.kind}-${marker.id}`} className="map-result" onClick={() => openMarker(marker)}><i className={`legend-${marker.kind === 'product' ? 'product' : 'request'}`} /><span><strong>{marker.title}</strong><small>{marker.kind === 'product' ? 'Товар' : 'Запит'} · {marker.distanceKm} км · {marker.geoZone}</small></span></button>)}</div><div className="map-legend"><span><i className="legend-product" /> Товари продавців</span><span><i className="legend-request" /> Запити покупців</span></div>{error && <p className="form-error">{error}</p>}</aside></div>{selectedRequest && <div className="map-request-panel"><button className="modal-close" onClick={() => setSelectedRequest(null)}>×</button><span className="eyebrow">Запит покупця</span><h2>{selectedRequest.title}</h2><p>{selectedRequest.description || 'Опис ще не додано.'}</p><div className="detail-facts"><span>⌖ <b>{selectedRequest.geoArea}</b><small>Приблизне місце</small></span><span>▧ <b>{selectedRequest.quantity} {selectedRequest.unit}</b><small>Потрібно</small></span><span>♧ <b>{selectedRequest.category.name}</b><small>Категорія</small></span></div></div>}</section>
}

function LegacyProductForm({ categories, product, onSaved, onCancel }: { categories: Category[]; product?: Product; onSaved: () => void; onCancel: () => void }) {
    const [photo, setPhoto] = useState(product?.photos[0]?.url ?? '')
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('')
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        const payload = { categoryId: data.categoryId, title: data.title, description: data.description, quantity: Number(data.quantity), unit: data.unit, price: Number(data.price), currency: data.currency, deliveryMode: data.deliveryMode, geoZone: data.geoZone, status: data.status, photos: photo ? [{ url: photo, alt: data.title }] : [] }
        try { await request(product ? `/api/products/${product.id}` : '/api/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); onSaved() } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
    }
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">{product ? 'Редагування' : 'Новий товар'}</span><h1>{product ? 'Оновити товар' : 'Додати товар'}</h1></div><button className="icon-button" onClick={onCancel}>×</button></div><form className="product-form" onSubmit={submit}><div className="photo-drop"><span className="photo-icon">▧</span><strong>{photo ? 'Фото додано' : 'Додайте фото товару'}</strong><small>URL зображення</small><input value={photo} onChange={(event) => setPhoto(event.target.value)} placeholder="https://..." /></div><label>Назва товару<input name="title" defaultValue={product?.title} required /></label><label>Категорія<select name="categoryId" defaultValue={product?.category.id ?? categories[0]?.id} required>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></label><div className="field-row"><label>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue={product?.quantity ?? 1} required /></label><label>Одиниця<select name="unit" defaultValue={product?.unit ?? 'kg'}><option value="kg">кг</option><option value="ton">тонна</option><option value="litre">літр</option><option value="piece">шт.</option></select></label></div><div className="field-row"><label>Ціна<input name="price" type="number" min="0" step=".01" defaultValue={product?.price.amount ?? 0} required /></label><label>Валюта<select name="currency" defaultValue={product?.price.currency ?? 'UAH'}><option>UAH</option><option>EUR</option><option>PLN</option></select></label></div><label>Місце / геозона<input name="geoZone" defaultValue={product?.geoZone} placeholder="Рівне, область" required /></label><label>Доставка<select name="deliveryMode" defaultValue={product?.deliveryMode ?? 'pickup'}><option value="pickup">Самовивіз</option><option value="seller_delivery">Доставка продавця</option><option value="carrier">Перевізник</option></select></label><label>Статус<select name="status" defaultValue={product?.status ?? 'draft'}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Опис<textarea name="description" defaultValue={product?.description} rows={4} /></label>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Збереження...' : product ? 'Зберегти зміни' : 'Опублікувати товар'} <span>→</span></button></form></section>
}

function ProductEditor({ categories, product, onSaved, onCancel }: { categories: Category[]; product?: Product; onSaved: () => void; onCancel: () => void }) {
    const [title, setTitle] = useState(product?.title ?? '')
    const [categoryId, setCategoryId] = useState(product?.category.id ?? categories[0]?.id ?? '')
    const [categoryQuery, setCategoryQuery] = useState(product?.category.name ?? '')
    const [photo, setPhoto] = useState(product?.photos[0]?.url ?? '')
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const categorySuggestions = categoryQuery.trim().length >= 3
        ? categories.filter((category) => category.name.toLocaleLowerCase('uk-UA').includes(categoryQuery.trim().toLocaleLowerCase('uk-UA'))).slice(0, 8)
        : []
    const selectCategory = (category: Category) => { setCategoryId(category.id); setCategoryQuery(category.name); setErrors((current) => ({ ...current, categoryId: '' })) }
    const fieldError = (field: string) => errors[field] ? <span className="field-error">{errors[field]}</span> : null
    const readFile = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file) }
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setErrors({})
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        const payload = { categoryId, title: title.trim(), description: data.description, quantity: Number(data.quantity), unit: data.unit, price: Number(data.price), currency: data.currency, deliveryMode: data.deliveryMode, geoZone: data.geoZone, status: data.status, photos: photo ? [{ ...(photo.startsWith('data:') ? { dataUrl: photo } : { url: photo }), alt: title.trim() }] : [] }
        try { await request(product ? `/api/products/${product.id}` : '/api/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); onSaved() }
        catch (caught) { const error = caught as ApiError; const nextErrors: Record<string, string> = {}; for (const field of error.fields ?? []) nextErrors[field] = ({ categoryId: 'Оберіть категорію', title: 'Введіть назву від 2 до 160 символів', description: 'Опис не може бути довшим за 5000 символів', quantity: 'Кількість має бути більшою за нуль', unit: 'Оберіть одиницю виміру', price: 'Ціна не може бути від’ємною', currency: 'Оберіть коректну валюту', deliveryMode: 'Оберіть спосіб доставки', geoZone: 'Вкажіть геозону', photos: 'Додайте коректне зображення' } as Record<string, string>)[field] ?? error.message; setErrors(nextErrors) }
        finally { setBusy(false) }
    }
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">{product ? 'Редагування' : 'Новий товар'}</span><h1>{product ? 'Оновити товар' : 'Додати товар'}</h1></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><form className="product-form" onSubmit={submit}><div className="photo-drop"><span className="photo-icon">▧</span><strong>{photo ? 'Фото додано' : 'Додайте фото товару'}</strong><small>PNG, JPG, WEBP або URL</small>{photo && <img className="photo-preview" src={photo} alt="Попередній перегляд" />}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => readFile(event.target.files?.[0])} /><input value={photo.startsWith('data:') ? '' : photo} onChange={(event) => setPhoto(event.target.value)} placeholder="Або вставте URL зображення" />{fieldError('photos')}</div><label className={errors.title ? 'field-invalid' : ''}>Назва товару<input value={title} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: '' })) }} required />{fieldError('title')}</label><label className={errors.categoryId ? 'field-invalid' : ''}>Категорія<input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Введіть мінімум 3 символи" autoComplete="off" required />{categorySuggestions.length > 0 && <div className="category-suggestions">{categorySuggestions.map((category) => <button type="button" key={category.id} onClick={() => selectCategory(category)}>{category.name}<small>{category.path ?? 'Агропродукція'}</small></button>)}</div>}{categoryQuery.length >= 3 && !categoryId && <span className="field-error">Оберіть категорію зі списку</span>}{fieldError('categoryId')}</label><input type="hidden" name="categoryId" value={categoryId} /><div className="field-row"><label className={errors.quantity ? 'field-invalid' : ''}>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue={product?.quantity ?? 1} required />{fieldError('quantity')}</label><label className={errors.unit ? 'field-invalid' : ''}>Одиниця<select name="unit" defaultValue={product?.unit ?? 'kg'}><option value="kg">кг</option><option value="ton">тонна</option><option value="litre">літр</option><option value="piece">шт.</option><option value="box">ящик</option></select>{fieldError('unit')}</label></div><div className="field-row"><label className={errors.price ? 'field-invalid' : ''}>Ціна<input name="price" type="number" min="0" step=".01" defaultValue={product?.price.amount ?? 0} required />{fieldError('price')}</label><label className={errors.currency ? 'field-invalid' : ''}>Валюта<select name="currency" defaultValue={product?.price.currency ?? 'UAH'}><option>UAH</option><option>EUR</option><option>PLN</option></select>{fieldError('currency')}</label></div><label className={errors.geoZone ? 'field-invalid' : ''}>Місце / геозона<input name="geoZone" defaultValue={product?.geoZone} placeholder="Рівне, область" required />{fieldError('geoZone')}</label><label className={errors.deliveryMode ? 'field-invalid' : ''}>Доставка<select name="deliveryMode" defaultValue={product?.deliveryMode ?? 'pickup'}><option value="pickup">Самовивіз</option><option value="seller_delivery">Доставка продавця</option><option value="carrier">Перевізник</option></select>{fieldError('deliveryMode')}</label><label>Статус<select name="status" defaultValue={product?.status ?? 'draft'}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={errors.description ? 'field-invalid' : ''}>Опис<textarea name="description" defaultValue={product?.description} rows={4} />{fieldError('description')}</label><button className="primary-button" disabled={busy}>{busy ? 'Збереження...' : product ? 'Зберегти зміни' : 'Опублікувати товар'} <span>→</span></button></form></section>
}

const ProductForm = ProductEditor

function BuyRequestForm({ categories, onSaved, onCancel }: { categories: Category[]; onSaved: () => void; onCancel: () => void }) {
    const [latitude, setLatitude] = useState('50.4506')
    const [longitude, setLongitude] = useState('30.5239')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
    const useLocation = () => navigator.geolocation.getCurrentPosition(
        (position) => { setLatitude(position.coords.latitude.toFixed(6)); setLongitude(position.coords.longitude.toFixed(6)) },
        () => setError('Не вдалося отримати ваше місцезнаходження'),
        { enableHighAccuracy: false, maximumAge: 300000 },
    )
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError(''); setFieldErrors({})
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        const payload = { categoryId: data.categoryId, title: data.title.trim(), description: data.description ?? '', quantity: Number(data.quantity), unit: data.unit, currency: data.currency, minPrice: Number(data.minPrice), maxPrice: Number(data.maxPrice), delivery: data.delivery, preferredDelivery: data.preferredDelivery || null, geoArea: data.geoArea.trim(), address: data.address.trim() || null, latitude: Number(latitude), longitude: Number(longitude), deadline: data.deadline ? new Date(`${data.deadline}T23:59:59.000Z`).toISOString() : null }
        try { await request('/api/buy-requests', { method: 'POST', body: JSON.stringify(payload) }); onSaved() }
        catch (caught) { const apiError = caught as ApiError; setError(apiError.message); for (const field of apiError.fields ?? []) setFieldErrors((current) => ({ ...current, [field]: 'Перевірте це поле' })) }
        finally { setBusy(false) }
    }
    const fieldError = (field: string) => fieldErrors[field] ? <span className="field-error">{fieldErrors[field]}</span> : null
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">Попит</span><h1>Створити запит на купівлю</h1><p className="view-subtitle">Продавці поблизу побачать лише приблизну точку.</p></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><form className="product-form request-form" onSubmit={submit}><label className={fieldErrors.title ? 'field-invalid' : ''}>Що потрібно<input name="title" placeholder="Наприклад, пшениця для господарства" required />{fieldError('title')}</label><label className={fieldErrors.categoryId ? 'field-invalid' : ''}>Категорія<select name="categoryId" defaultValue={categories[0]?.id ?? ''} required><option value="" disabled>Оберіть категорію</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{fieldError('categoryId')}</label><label>Опис<textarea name="description" rows={4} placeholder="Коротко опишіть вимоги" /></label><div className="field-row"><label>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue="1" required />{fieldError('quantity')}</label><label>Одиниця<select name="unit" defaultValue="kg"><option value="kg">кг</option><option value="ton">тонна</option><option value="litre">літр</option><option value="piece">шт.</option><option value="box">ящик</option></select></label></div><div className="field-row"><label>Мінімальна ціна<input name="minPrice" type="number" min="0" step=".01" defaultValue="0" required />{fieldError('minPrice')}</label><label>Максимальна ціна<input name="maxPrice" type="number" min="0" step=".01" defaultValue="0" required />{fieldError('maxPrice')}</label></div><label>Валюта<select name="currency" defaultValue="UAH"><option>UAH</option><option>EUR</option><option>PLN</option></select></label><div className="field-row"><label>Доставка<select name="delivery" defaultValue="preferred"><option value="no">Не потрібна</option><option value="yes">Потрібна</option><option value="preferred">Бажана</option></select></label><label>До дати<input name="deadline" type="date" /></label></div><label>Регіон пошуку<input name="geoArea" placeholder="Київ, Київська область" required />{fieldError('geoArea')}</label><label>Точна адреса для доставки <small className="form-hint">не показується на мапі</small><input name="address" placeholder="Необов’язково" /></label><div className="request-location"><div><strong>Приблизна точка на мапі</strong><small>Використовується тільки для пошуку поруч</small></div><button type="button" className="outline-button" onClick={useLocation}>⌖ Моє місце</button><div className="field-row"><label>Широта<input value={latitude} onChange={(event) => setLatitude(event.target.value)} type="number" step=".000001" min="-90" max="90" required /></label><label>Довгота<input value={longitude} onChange={(event) => setLongitude(event.target.value)} type="number" step=".000001" min="-180" max="180" required /></label></div></div>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Збереження…' : 'Опублікувати запит'} <span>→</span></button></form></section>
}

function App() {
    const [user, setUser] = useState<User | null>(null)
    const [view, setView] = useState<View>('home')
    const [products, setProducts] = useState<Product[]>([])
    const [mine, setMine] = useState<Product[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [selected, setSelected] = useState<Product | null>(null)
    const [editing, setEditing] = useState<Product>()
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pages, setPages] = useState(1)
    const [toast, setToast] = useState('')
    const [loading, setLoading] = useState(false)
    const notify = (message: string) => { setToast(message); window.setTimeout(() => setToast(''), 3000) }
    const loadProducts = async (nextPage = 1) => { setLoading(true); try { const params = new URLSearchParams({ page: String(nextPage), limit: '8' }); if (search) params.set('geoZone', search); const result = await request(`/api/products?${params}`); setProducts(result.products); setPage(result.pagination.page); setPages(result.pagination.pages) } catch (error) { notify((error as Error).message) } finally { setLoading(false) } }
    const loadMine = async () => { try { setMine((await request('/api/products/mine?limit=50')).products) } catch (error) { notify((error as Error).message) } }
    const go = (next: View) => { setView(next); setSelected(null); setEditing(undefined) }
    const logout = async () => { await request('/api/auth/logout', { method: 'POST' }); setUser(null) }
    const saved = () => { setView('mine'); setEditing(undefined); loadProducts(page); loadMine(); notify('Товар збережено') }
    const requestSaved = () => { setView('map'); notify('Запит опубліковано на мапі') }
    const removeProduct = async (product: Product) => { if (!window.confirm(`Видалити товар «${product.title}»?`)) return; try { await request(`/api/products/${product.id}`, { method: 'DELETE' }); setSelected(null); await loadProducts(page); await loadMine(); notify('Товар видалено') } catch (error) { notify((error as Error).message) } }
    useEffect(() => { request('/api/auth/me').then((result) => setUser(result.user)).catch(() => undefined); request('/api/categories').then((result) => setCategories(result.categories)).catch(() => undefined) }, [])
    useEffect(() => { if (user) { loadProducts(); loadMine() } }, [user])
    if (!user) return <Auth onLogin={setUser} />
    const nav = [['home', '⌂', 'Головна'], ['products', '⌕', 'Знайти товари'], ['map', '⌖', 'Мапа поруч'], ['request', '↗', 'Запит на купівлю'], ['mine', '▣', 'Мої товари'], ['create', '＋', 'Додати товар']] as const
    return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">N</span> Навпаки</div><div className="seller-badge"><div className="avatar">{user.username[0].toUpperCase()}</div><div><strong>{user.username}</strong><small>Мій кабінет</small></div></div><nav>{nav.map(([key, icon, text]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key)}><span>{icon}</span>{text}</button>)}<button onClick={() => notify('Розділ повідомлень готується')}><span>♧</span>Повідомлення</button></nav><button className="sidebar-exit" onClick={logout}>↪ Вийти</button></aside><main className="main-area"><header className="topbar"><button className="mobile-brand" onClick={() => go('home')}><span className="brand-mark">N</span> Навпаки</button><div className="topbar-actions"><button className="notification" onClick={() => notify('Нових повідомлень немає')}>♧</button><button className="top-avatar" onClick={() => go('profile')}>{user.username[0].toUpperCase()}</button></div></header>{view === 'home' && <Home user={user} products={products} open={setSelected} explore={() => go('products')} create={() => go('create')} />}{view === 'products' && <Catalog products={products} loading={loading} search={search} setSearch={setSearch} searchNow={() => loadProducts(1)} page={page} pages={pages} onPage={loadProducts} open={setSelected} />}{view === 'map' && <MapView categories={categories} openProduct={setSelected} notify={notify} />}{view === 'request' && <BuyRequestForm categories={categories} onSaved={requestSaved} onCancel={() => go('home')} />}{view === 'mine' && <Mine products={mine} open={setSelected} create={() => go('create')} edit={(product) => { setEditing(product); setView('create') }} />}{view === 'create' && <ProductForm categories={categories} product={editing} onSaved={saved} onCancel={() => go(editing ? 'mine' : 'home')} />}{view === 'profile' && <Profile user={user} logout={logout} />}</main><nav className="mobile-nav">{[['home', '⌂', 'Головна'], ['products', '⌕', 'Пошук'], ['map', '⌖', 'Мапа'], ['request', '↗', 'Запит'], ['profile', '♙', 'Профіль']].map(([key, icon, text]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key as View)}><span>{icon}</span>{text}</button>)}</nav>{selected && <ProductDetail product={selected} close={() => setSelected(null)} owner={selected.owner.id === user.id} edit={() => { setEditing(selected); setSelected(null); setView('create') }} />}{toast && <div className="toast">{toast}</div>}</div>
}

function Home({ user, products, open, explore, create }: { user: User; products: Product[]; open: (product: Product) => void; explore: () => void; create: () => void }) { return <section className="content"><div className="welcome"><div><span className="eyebrow">Понеділок, гарного дня</span><h1>Привіт, {user.username} <span>✦</span></h1><p>Що шукаєте або продаєте сьогодні?</p></div><button className="primary-button compact" onClick={create}>＋ Додати товар</button></div><div className="hero-strip"><div><span className="eyebrow">Локальний маркетплейс</span><h2>Ваш врожай<br /><em>має значення.</em></h2><button className="light-button" onClick={explore}>Переглянути товари <span>→</span></button></div><div className="hero-art">✦</div></div><div className="section-heading"><div><span className="eyebrow">Рекомендоване</span><h2>Товари поруч</h2></div><button className="text-button" onClick={explore}>Дивитись всі →</button></div><div className="product-grid">{products.slice(0, 4).map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} />)}</div>{!products.length && <Empty text="Поки немає активних товарів" />}</section> }
function Catalog({ products, loading, search, setSearch, searchNow, page, pages, onPage, open }: { products: Product[]; loading: boolean; search: string; setSearch: (value: string) => void; searchNow: () => void; page: number; pages: number; onPage: (page: number) => void; open: (product: Product) => void }) { const [categories, setCategories] = useState<Category[]>([]); const [selectedCategory, setSelectedCategory] = useState(''); const [catalogProducts, setCatalogProducts] = useState(products); const [catalogPage, setCatalogPage] = useState(page); const [catalogPages, setCatalogPages] = useState(pages); const [catalogLoading, setCatalogLoading] = useState(false); const runSearch = async (nextPage = 1, category = selectedCategory) => { setCatalogLoading(true); try { const params = new URLSearchParams({ page: String(nextPage), limit: '8' }); if (search) params.set('geoZone', search); if (category) params.set('categoryId', category); const result = await request(`/api/products?${params}`); setCatalogProducts(result.products); setCatalogPage(result.pagination.page); setCatalogPages(result.pagination.pages) } finally { setCatalogLoading(false) } }; useEffect(() => { request('/api/categories').then((result) => setCategories(result.categories)).catch(() => undefined) }, []); useEffect(() => { if (!selectedCategory && !search) { setCatalogProducts(products); setCatalogPage(page); setCatalogPages(pages) } }, [products, page, pages, selectedCategory, search]); const chooseCategory = (value: string) => { setSelectedCategory(value); runSearch(1, value) }; const busy = loading || catalogLoading; return <section className="content"><div className="view-header"><div><span className="eyebrow">Каталог</span><h1>Знайти товари</h1></div></div><div className="search-bar"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && runSearch(1)} placeholder="Пошук за місцем" /><button onClick={() => runSearch(1)}>Пошук</button></div><div className="filter-row"><span className="result-label">Активні товари</span><select className="filter-chip category-filter" value={selectedCategory} onChange={(event) => chooseCategory(event.target.value)}><option value="">Всі категорії</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>{busy ? <div className="loading">Завантаження каталогу...</div> : catalogProducts.length ? <><div className="product-grid">{catalogProducts.map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} />)}</div><Pagination page={catalogPage} pages={catalogPages} onPage={(nextPage) => { runSearch(nextPage); onPage(nextPage) }} /></> : <Empty text="Нічого не знайдено" />}</section> }
function Mine({ products, open, create, edit, remove }: { products: Product[]; open: (product: Product) => void; create: () => void; edit: (product: Product) => void; remove?: (product: Product) => void }) { const removeFromMine = remove ?? (async (product: Product) => { if (!window.confirm(`Видалити товар «${product.title}»?`)) return; await request(`/api/products/${product.id}`, { method: 'DELETE' }); window.location.reload() }); return <section className="content"><div className="view-header"><div><span className="eyebrow">Мій кабінет</span><h1>Мої товари</h1></div><button className="primary-button compact" onClick={create}>＋ Додати товар</button></div><div className="mine-summary"><strong>{products.length}</strong><span>всього товарів</span><strong>{products.filter((item) => item.status === 'active').length}</strong><span>активних</span></div>{products.length ? <div className="product-grid">{products.map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} onEdit={() => edit(product)} onDelete={() => removeFromMine(product)} />)}</div> : <Empty text="У вас ще немає товарів" action="Створити перший товар" onAction={create} />}</section> }
function Profile({ user, logout }: { user: User; logout: () => void }) { return <section className="content profile-view"><span className="eyebrow">Налаштування</span><h1>Профіль</h1><div className="profile-card"><div className="profile-avatar">{user.username[0].toUpperCase()}</div><h2>{user.username}</h2><p>{user.countryCode} · {user.phone}</p><div className="profile-line"><span>Статус акаунта</span><b>Підтверджений</b></div><button className="outline-button" onClick={logout}>Вийти з акаунта</button></div></section> }
export default App
