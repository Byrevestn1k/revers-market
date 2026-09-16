// @ts-nocheck
import { FormEvent, useEffect, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import PasswordInput from './PasswordInput'
import PhoneInput from './PhoneInput'
import PasswordReset from './PasswordReset'
import ResendCodeButton from './ResendCodeButton'

type User = { id: string; username: string; countryCode: string; phone: string; email: string | null; emailVerified: boolean }
type Category = { id: string; code?: string; name: string; path?: string }
type Product = { id: string; title: string; description: string; photos: { url: string; alt: string }[]; quantity: number; availableQuantity?: number; unit: string; price: { amount: number; currency: string }; deliveryMode: string; geoZone: string; status: string; owner: { id: string }; category: { id: string; name: string } }
type View = 'home' | 'products' | 'map' | 'mine' | 'create' | 'request' | 'requests' | 'market' | 'orders' | 'messages' | 'notifications' | 'profile'
type MapPoint = { latitude: number; longitude: number }
type MapMarker = MapPoint & { id: string; kind: 'product' | 'buyRequest'; title: string; geoZone: string; category: { id: string; name: string }; approximate: true; distanceKm: number }
type BuyRequest = { id: string; title: string; description: string; geoArea: string; category: { name: string }; quantity: number; fulfilledQuantity: number; unit: string; status: string; coordinates: MapPoint | null; buyer?: { id: string; username: string }; price: { min: number | null; max: number | null; currency: string }; delivery: { required: boolean; preferred: string | null }; deadline: string | null }
type ApiError = Error & { fields?: string[]; status?: number }
const API = import.meta.env.VITE_API_URL ?? ''
const FALLBACK = 'https://images.unsplash.com/photo-1500595046743-cd271d694d30?auto=format&fit=crop&w=900&q=80'
const STATUS: Record<string, string> = { draft: 'Чернетка', active: 'Активний', paused: 'Призупинений', sold: 'Проданий', expired: 'Завершений' }
const PRODUCT_STATUSES = ['draft', 'active', 'paused', 'sold', 'expired'] as const
const imageUrl = (url: string) => url.startsWith('/') ? `${API}${url}` : url

async function request(path: string, options?: RequestInit) {
    let response: Response
    try { response = await fetch(`${API}${path}`, { ...options, credentials: 'include', headers: { 'Content-Type': 'application/json', ...options?.headers } }) }
    catch { throw new Error('Не вдалося підключитися до сервера. Перевірте, чи запущений backend.') }
    const body = response.status === 204 ? null : await response.json()
    if (!response.ok) { const error = new Error(body?.message ?? 'Не вдалося виконати запит') as ApiError; error.fields = body?.fields ?? []; error.status = response.status; throw error }
    return body
}
const formatPrice = (amount: number, currency: string) => `${new Intl.NumberFormat('uk-UA').format(amount)} ${currency}`

function Auth({ onLogin }: { onLogin: (user: User) => void }) {
    const [registered, setRegistered] = useState<{ user: User; sent: boolean } | null>(null)
    const [register, setRegister] = useState(false)
    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
    const [busy, setBusy] = useState(false)
    const [resetMode, setResetMode] = useState(() => new URLSearchParams(window.location.search).has('reset-password'))
    const [resetSent, setResetSent] = useState(false)
    const [resetCode, setResetCode] = useState('')
    const [countryCode, setCountryCode] = useState('UA')
    const [phone, setPhone] = useState('')
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError(''); setFieldErrors({})
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        if (register && !/^[A-Za-z0-9_.-]{3,32}$/.test(data.username.trim())) { setFieldErrors({ username: 'Логін: 3–32 символи, лише латиниця, цифри, _, ., -' }); setBusy(false); return }
        if (register) { data.countryCode = countryCode; data.phone = phone }
        try { const result = await request(`/api/auth/${register ? 'register' : 'login'}`, { method: 'POST', body: JSON.stringify(data) }); if (register) setRegistered({ user: result.user, sent: result.emailVerificationSent }); else onLogin(result.user) }
        catch (caught) {
            const apiError = caught as ApiError
            setError(apiError.message)
            const nextErrors: Record<string, string> = {}
            for (const field of apiError.fields ?? []) {
                const message = String(field)
                if (message.toLowerCase().includes('користувача') || message.toLowerCase().includes('логін')) nextErrors.username = message
                else if (message.includes('пошту')) nextErrors.email = message
                else if (message.includes('код країни')) nextErrors.countryCode = message
                else if (message.includes('номер телефону')) nextErrors.phone = message
                else if (message.includes('Паролі')) nextErrors.passwordConfirmation = message
                else if (message.includes('Пароль')) nextErrors.password = message
            }
            setFieldErrors(nextErrors)
        } finally { setBusy(false) }
    }
    const fieldError = (field: string) => fieldErrors[field] ? <span className="field-error">{fieldErrors[field]}</span> : null
    if (resetMode) return <PasswordReset onBack={() => setResetMode(false)} />
    if (registered) return <main className="auth-page"><section className="auth-card verification-popup" role="dialog" aria-modal="true" aria-labelledby="verify-title"><h2 id="verify-title">Підтвердіть пошту</h2><p>Ваша електронна пошта: <strong>{registered.user.email}</strong></p><p>{registered.sent ? 'Ми надіслали лист із посиланням. Перевірте вхідні та папку «Спам».' : 'Лист ще не доставлено. Повторіть надсилання у профілі.'}</p><button autoFocus className="primary-button" onClick={() => onLogin(registered.user)}>Перейти до кабінету</button></section></main>
    return <main className="auth-page"><div className="auth-story"><div className="brand"><span className="brand-mark">N</span> Навпаки</div><span className="eyebrow">Маркетплейс поруч</span><h1>Продавайте те,<br /><em>що росте.</em></h1><p>Агропродукція від своїх. Чесно, локально, без зайвих кроків.</p></div><section className="auth-card"><span className="eyebrow">Ласкаво просимо</span><h2>{register ? 'Створіть акаунт' : 'З поверненням'}</h2><p>{register ? 'Почніть продавати врожай поруч.' : 'Увійдіть, щоб керувати товарами.'}</p><div className="auth-tabs"><button type="button" className={!register ? 'selected' : ''} onClick={() => { setRegister(false); setError(''); setFieldErrors({}) }}>Увійти</button><button type="button" className={register ? 'selected' : ''} onClick={() => { setRegister(true); setError(''); setFieldErrors({}) }}>Реєстрація</button></div><form onSubmit={submit}><label className={fieldErrors.username ? 'field-invalid' : ''}>{register ? 'Логін' : 'Логін, електронна пошта'}<input name="username" autoComplete="username" required minLength={register ? 3 : 1} maxLength={register ? 32 : 254} />{register && <small>3–32 символи: латиниця, цифри, _, ., -</small>}{fieldError('username')}</label>{register && <label>Електронна пошта<input name="email" type="email" autoComplete="email" required maxLength={254} />{fieldError('email')}</label>}{register && <PhoneInput countryCode={countryCode} phone={phone} onCountryCode={(code) => { setCountryCode(code); setFieldErrors((current) => ({ ...current, countryCode: '' })) }} onPhone={(value) => { setPhone(value); setFieldErrors((current) => ({ ...current, phone: '' })) }} error={fieldErrors.phone ?? fieldErrors.countryCode} />}<label className={fieldErrors.password ? 'field-invalid' : ''}>Пароль<PasswordInput name="password" autoComplete={register ? 'new-password' : 'current-password'} required />{fieldError('password')}</label>{!register && <button type="button" className="text-button" onClick={() => setResetMode(true)}>Не пам’ятаю пароль</button>}{register && <label className={fieldErrors.passwordConfirmation ? 'field-invalid' : ''}>Підтвердження пароля<PasswordInput name="passwordConfirmation" autoComplete="new-password" required />{fieldError('passwordConfirmation')}</label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Зачекайте...' : register ? 'Створити акаунт' : 'Увійти в акаунт'} <span>→</span></button></form></section></main>
}

function Card({ product, onOpen, onEdit, onDelete, onStatus }: { product: Product; onOpen: () => void; onEdit?: () => void; onDelete?: () => void; onStatus?: (status: typeof PRODUCT_STATUSES[number]) => void }) {
    return <article className="product-card" onClick={onOpen}><div className="product-image"><img src={imageUrl(product.photos[0]?.url || FALLBACK)} alt={product.photos[0]?.alt || product.title} /><span className={`status status-${product.status}`}>{STATUS[product.status]}</span>{onEdit && <button className="card-edit" onClick={(event) => { event.stopPropagation(); onEdit() }}>•••</button>}{onDelete && <button className="card-delete" onClick={(event) => { event.stopPropagation(); onDelete() }}>×</button>}</div><div className="product-card-body"><div className="product-card-title"><h3>{product.title}</h3><span className="heart">♡</span></div><strong className="price">{formatPrice(product.price.amount, product.price.currency)} <small>/ {product.unit}</small></strong><p><span>⌖</span> {product.geoZone}</p><div className="card-meta"><span>{product.quantity} {product.unit}</span><span>{product.category.name}</span></div>{onStatus && <label className="product-status-select" onClick={(event) => event.stopPropagation()}>Статус<select value={product.status} onChange={(event) => onStatus(event.target.value as typeof PRODUCT_STATUSES[number])}>{PRODUCT_STATUSES.map((status) => <option key={status} value={status}>{STATUS[status]}</option>)}</select></label>}</div></article>
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
    useEffect(() => {
        if (!categoryId && categories[0]) {
            setCategoryId(categories[0].id)
            setCategoryQuery(categories[0].name)
        }
    }, [categories, categoryId])
    const categorySuggestions = categoryQuery.trim().length >= 3
        ? categories.filter((category) => category.name.toLocaleLowerCase('uk-UA').includes(categoryQuery.trim().toLocaleLowerCase('uk-UA'))).slice(0, 8)
        : []
    const selectCategory = (category: Category) => { setCategoryId(category.id); setCategoryQuery(category.name); setErrors((current) => ({ ...current, categoryId: '' })) }
    const fieldError = (field: string) => errors[field] ? <span className="field-error">{errors[field]}</span> : null
    const readFile = (file?: File) => { if (!file) return; const reader = new FileReader(); reader.onload = () => setPhoto(String(reader.result)); reader.readAsDataURL(file) }
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setErrors({})
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        const remotePhoto = /^https?:\/\//i.test(photo)
        const payload = { categoryId, title: title.trim(), description: data.description, quantity: Number(data.quantity), unit: data.unit, price: Number(data.price), currency: data.currency, deliveryMode: data.deliveryMode, geoZone: data.geoZone, status: data.status, ...(photo.startsWith('data:') || remotePhoto ? { photos: [{ ...(photo.startsWith('data:') ? { dataUrl: photo } : { url: photo }), alt: title.trim() }] } : {}) }
        try { await request(product ? `/api/products/${product.id}` : '/api/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); onSaved() }
        catch (caught) { const error = caught as ApiError; const nextErrors: Record<string, string> = {}; for (const field of error.fields ?? []) nextErrors[field] = ({ categoryId: 'Оберіть категорію', title: 'Введіть назву від 2 до 160 символів', description: 'Опис не може бути довшим за 5000 символів', quantity: 'Кількість має бути більшою за нуль', unit: 'Оберіть одиницю виміру', price: 'Ціна не може бути від’ємною', currency: 'Оберіть коректну валюту', deliveryMode: 'Оберіть спосіб доставки', geoZone: 'Вкажіть геозону', photos: 'Додайте коректне зображення' } as Record<string, string>)[field] ?? error.message; setErrors(nextErrors) }
        finally { setBusy(false) }
    }
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">{product ? 'Редагування' : 'Новий товар'}</span><h1>{product ? 'Оновити товар' : 'Додати товар'}</h1></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><form className="product-form" onSubmit={submit}><div className="photo-drop"><span className="photo-icon">▧</span><strong>{photo ? 'Фото додано' : 'Додайте фото товару'}</strong><small>PNG, JPG, WEBP або URL</small>{photo && <img className="photo-preview" src={photo.startsWith('/') ? imageUrl(photo) : photo} alt="Попередній перегляд" />}<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => readFile(event.target.files?.[0])} /><input value={photo.startsWith('data:') ? '' : photo} onChange={(event) => setPhoto(event.target.value)} placeholder="Або вставте URL зображення" />{fieldError('photos')}</div><label className={errors.title ? 'field-invalid' : ''}>Назва товару<input value={title} onChange={(event) => { setTitle(event.target.value); setErrors((current) => ({ ...current, title: '' })) }} required />{fieldError('title')}</label><label className={errors.categoryId ? 'field-invalid' : ''}>Категорія<input value={categoryQuery} onChange={(event) => setCategoryQuery(event.target.value)} placeholder="Введіть мінімум 3 символи" autoComplete="off" required />{categorySuggestions.length > 0 && <div className="category-suggestions">{categorySuggestions.map((category) => <button type="button" key={category.id} onClick={() => selectCategory(category)}>{category.name}<small>{category.path ?? 'Агропродукція'}</small></button>)}</div>}{categoryQuery.length >= 3 && !categoryId && <span className="field-error">Оберіть категорію зі списку</span>}{fieldError('categoryId')}</label><input type="hidden" name="categoryId" value={categoryId} /><div className="field-row"><label className={errors.quantity ? 'field-invalid' : ''}>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue={product?.quantity ?? 1} required />{fieldError('quantity')}</label><label className={errors.unit ? 'field-invalid' : ''}>Одиниця<select name="unit" defaultValue={product?.unit ?? 'kg'}><option value="kg">кг</option><option value="ton">тонна</option><option value="litre">літр</option><option value="piece">шт.</option><option value="box">ящик</option></select>{fieldError('unit')}</label></div><div className="field-row"><label className={errors.price ? 'field-invalid' : ''}>Ціна<input name="price" type="number" min="0" step=".01" defaultValue={product?.price.amount ?? 0} required />{fieldError('price')}</label><label className={errors.currency ? 'field-invalid' : ''}>Валюта<select name="currency" defaultValue={product?.price.currency ?? 'UAH'}><option>UAH</option><option>EUR</option><option>PLN</option></select>{fieldError('currency')}</label></div><label className={errors.geoZone ? 'field-invalid' : ''}>Місце / геозона<input name="geoZone" defaultValue={product?.geoZone} placeholder="Рівне, область" required />{fieldError('geoZone')}</label><label className={errors.deliveryMode ? 'field-invalid' : ''}>Доставка<select name="deliveryMode" defaultValue={product?.deliveryMode ?? 'pickup'}><option value="pickup">Самовивіз</option><option value="seller_delivery">Доставка продавця</option><option value="carrier">Перевізник</option></select>{fieldError('deliveryMode')}</label><label>Статус<select name="status" defaultValue={product?.status ?? 'draft'}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={errors.description ? 'field-invalid' : ''}>Опис<textarea name="description" defaultValue={product?.description} rows={4} />{fieldError('description')}</label><button className="primary-button" disabled={busy}>{busy ? 'Збереження...' : product ? 'Зберегти зміни' : 'Опублікувати товар'} <span>→</span></button></form></section>
}

const ProductForm = ProductEditor

function BuyRequestForm({ categories, onSaved, onCancel }: { categories: Category[]; onSaved: () => void; onCancel: () => void }) {
    const [latitude, setLatitude] = useState('50.4506')
    const [longitude, setLongitude] = useState('30.5239')
    const [categoryId, setCategoryId] = useState('')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
    useEffect(() => {
        if (!categoryId && categories[0]) setCategoryId(categories[0].id)
    }, [categories, categoryId])
    const useLocation = () => navigator.geolocation.getCurrentPosition(
        (position) => { setLatitude(position.coords.latitude.toFixed(6)); setLongitude(position.coords.longitude.toFixed(6)) },
        () => setError('Не вдалося отримати ваше місцезнаходження'),
        { enableHighAccuracy: false, maximumAge: 300000 },
    )
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError(''); setFieldErrors({})
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        const payload = { categoryId: data.categoryId || categoryId, title: data.title.trim(), description: data.description ?? '', quantity: Number(data.quantity), unit: data.unit, currency: data.currency, minPrice: Number(data.minPrice), maxPrice: Number(data.maxPrice), delivery: data.delivery, preferredDelivery: data.preferredDelivery || null, geoArea: data.geoArea.trim(), address: data.address.trim() || null, latitude: latitude.trim() ? Number(latitude) : undefined, longitude: longitude.trim() ? Number(longitude) : undefined, deadline: data.deadline ? new Date(`${data.deadline}T23:59:59.000Z`).toISOString() : null }
        try { await request('/api/buy-requests', { method: 'POST', body: JSON.stringify(payload) }); onSaved() }
        catch (caught) { const apiError = caught as ApiError; setError(apiError.message); for (const field of apiError.fields ?? []) setFieldErrors((current) => ({ ...current, [field]: 'Перевірте це поле' })) }
        finally { setBusy(false) }
    }
    const fieldError = (field: string) => fieldErrors[field] ? <span className="field-error">{fieldErrors[field]}</span> : null
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">Попит</span><h1>Створити запит на купівлю</h1><p className="view-subtitle">Продавці поблизу побачать лише приблизну точку.</p></div><button className="icon-button" type="button" onClick={onCancel}>×</button></div><form className="product-form request-form" onSubmit={submit}><label className={fieldErrors.title ? 'field-invalid' : ''}>Що потрібно<input name="title" placeholder="Наприклад, пшениця для господарства" required />{fieldError('title')}</label><label className={fieldErrors.categoryId ? 'field-invalid' : ''}>Категорія<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)} required><option value="" disabled>Оберіть категорію</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select>{fieldError('categoryId')}</label><label>Опис<textarea name="description" rows={4} placeholder="Коротко опишіть вимоги" /></label><div className="field-row"><label>Кількість<input name="quantity" type="number" min=".001" step=".001" defaultValue="1" required />{fieldError('quantity')}</label><label>Одиниця<select name="unit" defaultValue="kg"><option value="kg">кг</option><option value="ton">тонна</option><option value="litre">літр</option><option value="piece">шт.</option><option value="box">ящик</option></select></label></div><div className="field-row"><label>Мінімальна ціна<input name="minPrice" type="number" min="0" step=".01" defaultValue="0" required />{fieldError('minPrice')}</label><label>Максимальна ціна<input name="maxPrice" type="number" min="0" step=".01" defaultValue="0" required />{fieldError('maxPrice')}</label></div><label>Валюта<select name="currency" defaultValue="UAH"><option>UAH</option><option>EUR</option><option>PLN</option></select></label><div className="field-row"><label>Доставка<select name="delivery" defaultValue="preferred"><option value="no">Не потрібна</option><option value="yes">Потрібна</option><option value="preferred">Бажана</option></select></label><label>До дати<input name="deadline" type="date" /></label></div><label>Регіон пошуку<input name="geoArea" placeholder="Київ, Київська область" required />{fieldError('geoArea')}</label><label>Точна адреса для доставки <small className="form-hint">не показується на мапі</small><input name="address" placeholder="Необов’язково" /></label><div className="request-location"><div><strong>Приблизна точка на мапі</strong><small>Використовується тільки для пошуку поруч</small></div><button type="button" className="outline-button" onClick={useLocation}>⌖ Моє місце</button><div className="field-row"><label>Широта<input value={latitude} onChange={(event) => setLatitude(event.target.value)} type="number" step=".000001" min="-90" max="90" required /></label><label>Довгота<input value={longitude} onChange={(event) => setLongitude(event.target.value)} type="number" step=".000001" min="-180" max="180" required /></label></div></div>{error && <p className="form-error">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Збереження…' : 'Опублікувати запит'} <span>→</span></button></form></section>
}

function App() {
    const [user, setUser] = useState<User | null>(null)
    const [view, setView] = useState<View>('home')
    const [products, setProducts] = useState<Product[]>([]) // This line is unchanged
    const [mine, setMine] = useState<Product[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [selected, setSelected] = useState<Product | null>(null)
    const [editing, setEditing] = useState<Product>()
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pages, setPages] = useState(1)
    const [toast, setToast] = useState('')
    const [loading, setLoading] = useState(false)
    const notify = (message: string) => { if (message === 'Нових повідомлень немає') { setView('notifications'); return }; setToast(message); window.setTimeout(() => setToast(''), 3000) }
    const loadProducts = async (nextPage = 1) => { setLoading(true); try { const params = new URLSearchParams({ page: String(nextPage), limit: '8' }); if (search) params.set('geoZone', search); const result = await request(`/api/products?${params}`); setProducts(result.products); setPage(result.pagination.page); setPages(result.pagination.pages) } catch (error) { notify((error as Error).message) } finally { setLoading(false) } }
    const loadMine = async () => { try { setMine((await request('/api/products/mine?limit=50')).products) } catch (error) { notify((error as Error).message) } }
    const go = (next: View) => { setView(next); setSelected(null); setEditing(undefined) }
    const logout = async () => { await request('/api/auth/logout', { method: 'POST' }); setUser(null) }
    const saved = () => { setView('mine'); setEditing(undefined); loadProducts(page); loadMine(); notify('Товар збережено') }
    const requestSaved = () => { setView('map'); notify('Запит опубліковано на мапі') }
    const removeProduct = async (product: Product) => { if (!window.confirm(`Видалити товар «${product.title}»?`)) return; try { await request(`/api/products/${product.id}`, { method: 'DELETE' }); setSelected(null); await loadProducts(page); await loadMine(); notify('Товар видалено') } catch (error) { notify((error as Error).message) } }
    useEffect(() => { request('/api/auth/me').then((result) => setUser(result.user)).catch(() => undefined); request('/api/categories').then((result) => setCategories(result.categories)).catch(() => undefined) }, [])
    useEffect(() => { if (user) { loadProducts(); loadMine() } }, [user])
    if (window.location.pathname === '/verify-email') return <VerifyEmail />
    if (new URLSearchParams(window.location.search).has('reset-password') || !user) return <Auth onLogin={setUser} />
    if (view === 'messages') return <MessagesView notify={notify} />
    if (view === 'notifications') return <NotificationsView notify={notify} />
    const nav = [['home', '⌂', 'Головна'], ['products', '⌕', 'Знайти товари'], ['map', '⌖', 'Мапа поруч'], ['request', '↗', 'Новий запит'], ['requests', '⇅', 'Мої запити'], ['market', '⇄', 'Запити покупців'], ['orders', '▣', 'Замовлення'], ['messages', '♧', 'Повідомлення'], ['notifications', '•', 'Сповіщення'], ['mine', '▣', 'Мої товари'], ['create', '＋', 'Додати товар']] as const
    return <div className="app-shell"><aside className="sidebar"><div className="brand"><span className="brand-mark">N</span> Навпаки</div><div className="seller-badge"><div className="avatar">{user.username[0].toUpperCase()}</div><div><strong>{user.username}</strong><small>Мій кабінет</small></div></div><nav>{nav.map(([key, icon, text]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key)}><span>{icon}</span>{text}</button>)}<button className="notification" onClick={() => go('messages')}><span>♧</span>Повідомлення</button></nav><button className="sidebar-exit" onClick={logout}>↪ Вийти</button></aside><main className="main-area"><header className="topbar"><button className="mobile-brand" onClick={() => go('home')}><span className="brand-mark">N</span> Навпаки</button><div className="topbar-actions"><button className="notification" onClick={() => notify('Нових повідомлень немає')}>♧</button><button className="top-avatar" onClick={() => go('profile')}>{user.username[0].toUpperCase()}</button></div></header>{view === 'home' && <Home user={user} products={products} open={setSelected} explore={() => go('products')} create={() => go('create')} />}{view === 'products' && <Catalog products={products} loading={loading} search={search} setSearch={setSearch} searchNow={() => loadProducts(1)} page={page} pages={pages} onPage={loadProducts} open={setSelected} />}{view === 'map' && <MapView categories={categories} openProduct={setSelected} notify={notify} />}{view === 'request' && <BuyRequestForm categories={categories} onSaved={requestSaved} onCancel={() => go('home')} />}{view === 'mine' && <Mine products={mine} open={setSelected} create={() => go('create')} edit={(product) => { setEditing(product); setView('create') }} setStatus={async (product, status) => { try { await request(`/api/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadMine(); notify('Статус оновлено') } catch (error) { notify((error as Error).message) } }} />}{view === 'create' && <ProductForm categories={categories} product={editing} onSaved={saved} onCancel={() => go(editing ? 'mine' : 'home')} />}{view === 'requests' && <MyRequests notify={notify} create={() => go('request')} />}{view === 'market' && <RequestsMarket mine={mine} notify={notify} />}{view === 'orders' && <OrdersView notify={notify} />}{view === 'profile' && <ProfileView logout={logout} notify={notify} />}</main><nav className="mobile-nav">{[['home', '⌂', 'Головна'], ['products', '⌕', 'Пошук'], ['map', '⌖', 'Мапа'], ['request', '↗', 'Запит'], ['profile', '♙', 'Профіль']].map(([key, icon, text]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key as View)}><span>{icon}</span>{text}</button>)}</nav>{selected && <ProductDetail product={selected} close={() => setSelected(null)} owner={selected.owner.id === user.id} edit={() => { setEditing(selected); setSelected(null); setView('create') }} />}{toast && <div className="toast">{toast}</div>}</div>
}

function Home({ user, products, open, explore, create }: { user: User; products: Product[]; open: (product: Product) => void; explore: () => void; create: () => void }) { return <section className="content"><div className="welcome"><div><span className="eyebrow">Понеділок, гарного дня</span><h1>Привіт, {user.username} <span>✦</span></h1><p>Що шукаєте або продаєте сьогодні?</p></div><button className="primary-button compact" onClick={create}>＋ Додати товар</button></div><div className="hero-strip"><div><span className="eyebrow">Локальний маркетплейс</span><h2>Ваш врожай<br /><em>має значення.</em></h2><button className="light-button" onClick={explore}>Переглянути товари <span>→</span></button></div><div className="hero-art">✦</div></div><div className="section-heading"><div><span className="eyebrow">Рекомендоване</span><h2>Товари поруч</h2></div><button className="text-button" onClick={explore}>Дивитись всі →</button></div><div className="product-grid">{products.slice(0, 4).map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} />)}</div>{!products.length && <Empty text="Поки немає активних товарів" />}</section> }
function Catalog({ products, loading, search, setSearch, searchNow, page, pages, onPage, open }: { products: Product[]; loading: boolean; search: string; setSearch: (value: string) => void; searchNow: () => void; page: number; pages: number; onPage: (page: number) => void; open: (product: Product) => void }) { const [categories, setCategories] = useState<Category[]>([]); const [selectedCategory, setSelectedCategory] = useState(''); const [catalogProducts, setCatalogProducts] = useState(products); const [catalogPage, setCatalogPage] = useState(page); const [catalogPages, setCatalogPages] = useState(pages); const [catalogLoading, setCatalogLoading] = useState(false); const runSearch = async (nextPage = 1, category = selectedCategory) => { setCatalogLoading(true); try { const params = new URLSearchParams({ page: String(nextPage), limit: '8' }); if (search) params.set('geoZone', search); if (category) params.set('categoryId', category); const result = await request(`/api/products?${params}`); setCatalogProducts(result.products); setCatalogPage(result.pagination.page); setCatalogPages(result.pagination.pages) } finally { setCatalogLoading(false) } }; useEffect(() => { request('/api/categories').then((result) => setCategories(result.categories)).catch(() => undefined) }, []); useEffect(() => { if (!selectedCategory && !search) { setCatalogProducts(products); setCatalogPage(page); setCatalogPages(pages) } }, [products, page, pages, selectedCategory, search]); const chooseCategory = (value: string) => { setSelectedCategory(value); runSearch(1, value) }; const busy = loading || catalogLoading; return <section className="content"><div className="view-header"><div><span className="eyebrow">Каталог</span><h1>Знайти товари</h1></div></div><div className="search-bar"><span>⌕</span><input value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && runSearch(1)} placeholder="Пошук за місцем" /><button onClick={() => runSearch(1)}>Пошук</button></div><div className="filter-row"><span className="result-label">Активні товари</span><select className="filter-chip category-filter" value={selectedCategory} onChange={(event) => chooseCategory(event.target.value)}><option value="">Всі категорії</option>{categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}</select></div>{busy ? <div className="loading">Завантаження каталогу...</div> : catalogProducts.length ? <><div className="product-grid">{catalogProducts.map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} />)}</div><Pagination page={catalogPage} pages={catalogPages} onPage={(nextPage) => { runSearch(nextPage); onPage(nextPage) }} /></> : <Empty text="Нічого не знайдено" />}</section> }
function Mine({ products, open, create, edit, remove, setStatus }: { products: Product[]; open: (product: Product) => void; create: () => void; edit: (product: Product) => void; remove?: (product: Product) => void; setStatus?: (product: Product, status: string) => void }) { const removeFromMine = remove ?? (async (product: Product) => { if (!window.confirm(`Видалити товар «${product.title}»?`)) return; await request(`/api/products/${product.id}`, { method: 'DELETE' }); window.location.reload() }); return <section className="content"><div className="view-header"><div><span className="eyebrow">Мій кабінет</span><h1>Мої товари</h1></div><button className="primary-button compact" onClick={create}>＋ Додати товар</button></div><div className="mine-summary"><strong>{products.length}</strong><span>всього товарів</span><strong>{products.filter((item) => item.status === 'active').length}</strong><span>активних</span></div>{products.length ? <div className="product-grid">{products.map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} onEdit={() => edit(product)} onDelete={() => removeFromMine(product)} onStatus={setStatus ? (status) => setStatus(product, status) : undefined} />)}</div> : <Empty text="У вас ще немає товарів" action="Створити перший товар" onAction={create} />}</section> }
type Offer = { id: string; seller: { id: string; username: string }; buyRequestId: string; existingProduct: { id: string; title: string } | null; quantity: number; acceptedQuantity: number; unit: string; price: { amount: number; currency: string }; delivery: string; note: string; status: string; createdAt: string }
type Order = { id: string; buyRequestId: string; buyer: { id: string; username: string }; seller: { id: string; username: string }; quantity: number | null; unit: string; price: { unit: number | null; currency: string }; subtotal: number; status: string; conditionsSnapshot: { productTitle?: string } | null; cancelReason?: string | null; dispute?: { status: string; reason: string; resolution: string | null } | null }
type ChatMessage = { id: string; senderId: string; senderUsername: string; body: string; createdAt: string }
type Conversation = { id: string; orderId: string; status: string; otherUsername: string; lastMessage: string | null; lastMessageAt: string | null; lastReadAt: string | null }
type Notification = { id: string; type: string; title: string; body: string; orderId: string | null; conversationId: string | null; readAt: string | null; createdAt: string }
type PublicProfile = { id: string; username: string; nickname: string | null; avatarUrl: string | null; bio: string | null; countryCode: string; location: string | null; phone: string | null; statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }; ratingSummary: { average: number | null; count: number }; createdAt: string }
type PrivateProfile = { id: string; username: string; nickname: string | null; avatarUrl: string | null; bio: string | null; countryCode: string; location: string | null; phone: string; email: string | null; emailVerified: boolean; recoveryEmail: string | null; exactAddress: string | null; privacy: { phoneVisibility: 'private' | 'authenticated' | 'public'; phoneDisclosureConsent: boolean }; statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }; ratingSummary: { average: number | null; count: number } }
const OFFER_STATUS: Record<string, string> = { submitted: 'Очікує', accepted: 'Прийнято', partially_accepted: 'Частково прийнято', rejected: 'Відхилено', withdrawn: 'Відкликано', expired: 'Завершено' }
const ORDER_STATUS: Record<string, string> = { accepted: 'Прийняте', in_progress: 'Виконується', completed: 'Завершене', cancelled: 'Скасоване', rejected: 'Відхилене', expired: 'Закінчене', disputed: 'Спір' }
const REQUEST_STATUS: Record<string, string> = { open: 'Відкритий', partially_fulfilled: 'Частково виконаний', fulfilled: 'Виконаний', cancelled: 'Скасований', expired: 'Завершений' }

function OfferForm({ buyRequest, products, notify, onDone }: { buyRequest: BuyRequest; products: Product[]; notify: (message: string) => void; onDone: () => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('')
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        try {
            await request(`/api/buy-requests/${buyRequest.id}/offers`, { method: 'POST', body: JSON.stringify({ quantity: Number(data.quantity), unit: buyRequest.unit, price: Number(data.price), currency: buyRequest.price.currency, delivery: data.delivery, note: data.note || '', productId: data.productId || undefined }) })
            notify('Пропозицію надіслано'); onDone()
        } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
    }
    const remaining = buyRequest.quantity - buyRequest.fulfilledQuantity
    return <form className="offer-form" onSubmit={submit}>
        <div className="field-row">
            <label>Кількість ({buyRequest.unit})<input name="quantity" type="number" min=".001" step=".001" max={remaining} defaultValue={remaining} required /></label>
            <label>Ціна за {buyRequest.unit}<input name="price" type="number" min="0" step=".01" required /></label>
        </div>
        <div className="field-row">
            <label>Доставка<input name="delivery" placeholder="Самовивіз / перевізник" maxLength={160} required /></label>
            <label>Мій товар<select name="productId"><option value="">Без прив’язки</option>{products.map((product) => <option key={product.id} value={product.id}>{product.title}</option>)}</select></label>
        </div>
        <label>Коментар<input name="note" placeholder="Умови, деталі" maxLength={500} /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Надсилання…' : 'Запропонувати'}</button>
    </form>
}

function RequestsMarket({ mine, notify }: { mine: Product[]; notify: (message: string) => void }) {
    const [requests, setRequests] = useState<BuyRequest[]>([])
    const [openForm, setOpenForm] = useState('')
    const [myOffers, setMyOffers] = useState<Offer[]>([])
    const [editingOffer, setEditingOffer] = useState('')
    const [chat, setChat] = useState<{ conversationId: string; title: string } | null>(null)
    const load = async () => {
        try {
            setRequests((await request('/api/buy-requests')).buyRequests)
            setMyOffers((await request('/api/offers/mine')).offers)
        } catch (error) { notify((error as Error).message) }
    }
    useEffect(() => { load() }, [])
    const withdraw = async (offer: Offer) => {
        if (!window.confirm('Відкликати цю пропозицію?')) return
        try { await request(`/api/offers/${offer.id}`, { method: 'DELETE' }); notify('Пропозицію відкликано'); load() } catch (error) { notify((error as Error).message) }
    }
    const saveOffer = async (offer: Offer) => {
        const priceRaw = window.prompt('Нова ціна за одиницю', String(offer.price.amount))
        if (priceRaw === null) return
        const note = window.prompt('Коментар до пропозиції', offer.note ?? '')
        if (note === null) return
        const price = Number(priceRaw)
        if (!Number.isFinite(price) || price < 0) { notify('Некоректна ціна'); return }
        try { await request(`/api/offers/${offer.id}`, { method: 'PATCH', body: JSON.stringify({ price, note }) }); notify('Пропозицію оновлено'); setEditingOffer(''); load() } catch (error) { notify((error as Error).message) }
    }
    const openOfferChat = async (offer: Offer) => {
        try { const result = await request(`/api/offers/${offer.id}/conversation`, { method: 'POST', body: '{}' }); setChat({ conversationId: result.conversation.id, title: offer.seller.username }) } catch (error) { notify((error as Error).message) }
    }
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Попит</span><h1>Запити покупців</h1><p className="view-subtitle">Відгукніться своєю пропозицією на запити поруч.</p></div><button className="outline-button" onClick={load}>↻ Оновити</button></div>
        <div className="request-list">{requests.map((item) => <article key={item.id} className="request-card"><header><div><span className="eyebrow">{item.category.name} · {item.geoArea}</span><h3>{item.title}</h3></div><span className={`status status-${item.status}`}>{REQUEST_STATUS[item.status] ?? item.status}</span></header>
            <p>{item.description || 'Опис не додано.'}</p>
            <div className="card-meta"><span>{item.quantity} {item.unit}</span><span>{item.price.min ?? '—'}–{item.price.max ?? '—'} {item.price.currency}</span><span>{item.delivery.required ? 'Доставка потрібна' : 'Без доставки'}</span></div>
            {openForm === item.id ? <OfferForm buyRequest={item} products={mine} notify={notify} onDone={() => { setOpenForm(''); load() }} /> : <button className="primary-button compact" onClick={() => setOpenForm(item.id)}>Запропонувати</button>}
        </article>)}{!requests.length && <Empty text="Відкритих запитів поки немає" />}</div>
        <div className="view-header" style={{ marginTop: '2rem' }}><div><span className="eyebrow">Мої пропозиції</span><h2>Керування пропозиціями</h2></div></div>
        <div className="request-list">{myOffers.map((offer) => <article key={offer.id} className="request-card"><header><div><span className="eyebrow">Пропозиція</span><h3>{offer.existingProduct?.title ?? 'Без прив’язки до товару'}</h3></div><span className="status status-paused">{OFFER_STATUS[offer.status] ?? offer.status}</span></header>
            <div className="card-meta"><span>{offer.quantity} {offer.unit}</span><span>{formatPrice(offer.price.amount, offer.price.currency)} / {offer.unit}</span><span>Прийнято: {offer.acceptedQuantity}</span></div>
            <div className="request-actions">
                <button className="outline-button compact" onClick={() => openOfferChat(offer)}>♧ Чат</button>
                {offer.status === 'submitted' && offer.acceptedQuantity === 0 && <button className="outline-button compact" onClick={() => setEditingOffer(editingOffer === offer.id ? '' : offer.id)}>Редагувати</button>}
                {offer.status === 'submitted' && offer.acceptedQuantity === 0 && <button className="outline-button compact" onClick={() => withdraw(offer)}>Відкликати</button>}
            </div>
            {editingOffer === offer.id && <OfferEditForm offer={offer} notify={notify} onDone={() => { setEditingOffer(''); load() }} />}
        </article>)}{!myOffers.length && <Empty text="Ви ще не надсилали пропозицій" />}</div>
        {chat && <ChatPanel chat={chat} onClose={() => setChat(null)} notify={notify} />}
    </section>
}

function OfferEditForm({ offer, notify, onDone }: { offer: Offer; notify: (message: string) => void; onDone: () => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('')
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        try { await request(`/api/offers/${offer.id}`, { method: 'PATCH', body: JSON.stringify({ price: Number(data.price), note: data.note || '' }) }); notify('Пропозицію оновлено'); onDone() } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
    }
    return <form className="offer-form" onSubmit={submit}>
        <div className="field-row">
            <label>Ціна за {offer.unit}<input name="price" type="number" min="0" step="0.01" defaultValue={offer.price.amount} required /></label>
            <label>Коментар<input name="note" defaultValue={offer.note} maxLength={500} /></label>
        </div>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Збереження…' : 'Зберегти пропозицію'}</button>
    </form>
}

function MyRequests({ notify, create }: { notify: (message: string) => void; create: () => void }) {
    const [requests, setRequests] = useState<BuyRequest[]>([])
    const [offers, setOffers] = useState<Record<string, Offer[]>>({})
    const [expanded, setExpanded] = useState('')
    const [chat, setChat] = useState<{ conversationId: string; title: string } | null>(null)
    const load = async () => { try { setRequests((await request('/api/buy-requests?mine=true')).buyRequests) } catch (error) { notify((error as Error).message) } }
    useEffect(() => { load() }, [])
    const toggle = async (id: string) => {
        if (expanded === id) { setExpanded(''); return }
        setExpanded(id)
        try { const result = await request(`/api/buy-requests/${id}/offers`); setOffers((current) => ({ ...current, [id]: result.offers })) } catch (error) { notify((error as Error).message) }
    }
    const accept = async (offer: Offer) => {
        const remaining = offer.quantity - offer.acceptedQuantity
        const raw = window.prompt(`Кількість до прийняття (до ${remaining} ${offer.unit})`, String(remaining))
        if (raw === null) return
        const quantity = Number(raw)
        if (!Number.isFinite(quantity) || quantity <= 0 || quantity > remaining) { notify('Вкажіть коректну кількість'); return }
        if (!window.confirm(`Прийняти ${quantity} ${offer.unit} від ${offer.seller.username}?`)) return
        try { await request(`/api/offers/${offer.id}/accept`, { method: 'POST', body: JSON.stringify({ quantity }) }); notify('Пропозицію прийнято — створено замовлення'); setExpanded(''); load() } catch (caught) { notify((caught as Error).message) }
    }
    const cancel = async (item: BuyRequest) => {
        if (!window.confirm('Скасувати цей запит?')) return
        try { await request(`/api/buy-requests/${item.id}`, { method: 'PATCH', body: JSON.stringify({ status: 'cancelled' }) }); notify('Запит скасовано'); load() } catch (error) { notify((error as Error).message) }
    }
    const saveRequest = async (item: BuyRequest) => {
        const title = window.prompt('Нова назва запиту', item.title)
        if (title === null || !title.trim()) return
        const description = window.prompt('Новий опис запиту', item.description ?? '')
        if (description === null) return
        try { await request(`/api/buy-requests/${item.id}`, { method: 'PATCH', body: JSON.stringify({ title: title.trim(), description }) }); notify('Запит оновлено'); load() } catch (error) { notify((error as Error).message) }
    }
    const rejectOffer = async (offer: Offer) => {
        if (!window.confirm(`Відхилити пропозицію від ${offer.seller.username}?`)) return
        try { await request(`/api/offers/${offer.id}/reject`, { method: 'POST', body: '{}' }); notify('Пропозицію відхилено'); load() } catch (error) { notify((error as Error).message) }
    }
    const openOfferChat = async (offer: Offer) => {
        try { const result = await request(`/api/offers/${offer.id}/conversation`, { method: 'POST', body: '{}' }); setChat({ conversationId: result.conversation.id, title: offer.seller.username }) } catch (error) { notify((error as Error).message) }
    }
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Мій попит</span><h1>Мої запити</h1><p className="view-subtitle">Переглядайте пропозиції продавців і приймайте їх повністю або частково.</p></div></div>
        <div className="request-list">{requests.map((item) => <article key={item.id} className="request-card"><header><div><span className="eyebrow">{item.category.name} · {item.geoArea}</span><h3>{item.title}</h3></div><span className="status status-active">{REQUEST_STATUS[item.status] ?? item.status}</span></header>
            <div className="card-meta"><span>{item.fulfilledQuantity}/{item.quantity} {item.unit}</span><span>{item.price.min ?? '—'}–{item.price.max ?? '—'} {item.price.currency}</span><span>{item.deadline ? `до ${new Date(item.deadline).toLocaleDateString('uk-UA')}` : 'без дедлайну'}</span></div>
            <div className="request-actions"><button className="outline-button" onClick={() => toggle(item.id)}>Пропозиції{offers[item.id] ? ` (${offers[item.id].length})` : ''}</button>
                {(item.status === 'open' || item.status === 'partially_fulfilled') && <button className="outline-button" onClick={() => saveRequest(item)}>Редагувати</button>}
                {(item.status === 'open' || item.status === 'partially_fulfilled') && <button className="outline-button" onClick={() => cancel(item)}>Скасувати</button>}</div>
            {expanded === item.id && <div className="offer-list">{(offers[item.id] ?? []).map((offer) => <div key={offer.id} className="offer-row">
                <div><strong>{offer.seller.username}{offer.existingProduct ? ` · ${offer.existingProduct.title}` : ''}</strong><small>{offer.quantity} {offer.unit} · {formatPrice(offer.price.amount, offer.price.currency)} / {offer.unit} · {offer.delivery}</small>{offer.note && <small>{offer.note}</small>}</div>
                <span className="status status-paused">{OFFER_STATUS[offer.status] ?? offer.status}</span>
                {(offer.status === 'submitted' || offer.status === 'partially_accepted') && <button className="primary-button compact" onClick={() => accept(offer)}>Прийняти {offer.quantity - offer.acceptedQuantity} {offer.unit}</button>}
                <button className="outline-button compact" onClick={() => openOfferChat(offer)}>♧ Чат</button>
                {(offer.status === 'submitted' || offer.status === 'partially_accepted') && <button className="outline-button compact" onClick={() => rejectOffer(offer)}>Відхилити</button>}
            </div>)}{!offers[item.id]?.length && <Empty text="Пропозицій ще немає" />}</div>}
        </article>)}{!requests.length && <Empty text="У вас ще немає запитів" action="Створити запит" onAction={create} />}</div></section>
}

function ChatPanel({ chat, onClose, notify }: { chat: { conversationId: string; title: string }; onClose: () => void; notify: (message: string) => void }) {
    const [messages, setMessages] = useState<ChatMessage[]>([])
    const [text, setText] = useState('')
    const load = async () => {
        try { const result = await request(`/api/conversations/${chat.conversationId}/messages`); setMessages(result.messages); await request(`/api/conversations/${chat.conversationId}/read`, { method: 'PATCH' }) } catch (error) { notify((error as Error).message) }
    }
    useEffect(() => { load(); const timer = window.setInterval(load, 4000); return () => window.clearInterval(timer) }, [chat.conversationId])
    const send = async () => {
        const body = text.trim(); if (!body) return
        try { await request(`/api/conversations/${chat.conversationId}/messages`, { method: 'POST', body: JSON.stringify({ body }) }); setText(''); load() } catch (error) { notify((error as Error).message) }
    }
    return <div className="modal-backdrop" onClick={onClose}><section className="chat-modal" onClick={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose}>×</button><span className="eyebrow">Чат замовлення</span><h2>{chat.title}</h2>
        <div className="chat-messages">{messages.map((message) => <div key={message.id} className="chat-message"><b>{message.senderUsername}</b><span>{message.body}</span><small>{new Date(message.createdAt).toLocaleString('uk-UA')}</small></div>)}</div>
        <div className="chat-input"><input value={text} onChange={(event) => setText(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && send()} placeholder="Повідомлення…" /><button className="primary-button compact" onClick={send}>➤</button></div>
    </section></div>
}

function MessagesView({ notify }: { notify: (message: string) => void }) {
    const [conversations, setConversations] = useState<Conversation[]>([])
    const [chat, setChat] = useState<{ conversationId: string; title: string } | null>(null)
    const load = async () => { try { setConversations((await request('/api/conversations')).conversations) } catch (error) { notify((error as Error).message) } }
    useEffect(() => { load() }, [])
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Спілкування</span><h1>Повідомлення</h1><p className="view-subtitle">Чати прив’язані до реальних замовлень.</p></div><button className="outline-button" onClick={load}>↻ Оновити</button></div><div className="conversation-list">{conversations.map((conversation) => <button className="conversation-row" key={conversation.id} onClick={() => setChat({ conversationId: conversation.id, title: `Замовлення з ${conversation.otherUsername}` })}><span><strong>{conversation.otherUsername}</strong><small>{conversation.lastMessage ?? 'Повідомлень ще немає'}</small></span><small>{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString('uk-UA') : ''}</small></button>)}{!conversations.length && <Empty text="Повідомлень поки немає" />}</div>{chat && <ChatPanel chat={chat} onClose={() => setChat(null)} notify={notify} />}</section>
}

function NotificationsView({ notify }: { notify: (message: string) => void }) {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const load = async () => { try { setNotifications((await request('/api/notifications')).notifications) } catch (error) { notify((error as Error).message) } }
    useEffect(() => { load() }, [])
    const markAllRead = async () => { try { await request('/api/notifications/read', { method: 'PATCH', body: '{}' }); await load() } catch (error) { notify((error as Error).message) } }
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Центр подій</span><h1>Сповіщення</h1></div><button className="outline-button" onClick={markAllRead}>Позначити прочитаними</button></div><div className="notification-list">{notifications.map((item) => <article className={`notification-row ${item.readAt ? '' : 'unread'}`} key={item.id}><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString('uk-UA')}</small></article>)}{!notifications.length && <Empty text="Нових сповіщень немає" />}</div></section>
}

function ReviewForm({ order, notify, onDone }: { order: Order; notify: (message: string) => void; onDone: () => void }) {
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setError('')
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        try { await request(`/api/orders/${order.id}/reviews`, { method: 'POST', body: JSON.stringify({ rating: Number(data.rating), body: data.body }) }); notify('Відгук надіслано'); onDone() } catch (caught) { setError((caught as Error).message) } finally { setBusy(false) }
    }
    return <form className="offer-form" onSubmit={submit}>
        <div className="field-row">
            <label>Оцінка (1–5)<select name="rating" required>{Array.from({ length: 5 }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
        </div>
        <label>Коментар<input name="body" maxLength={2000} placeholder="Як пройшла угода?" /></label>
        {error && <p className="form-error">{error}</p>}
        <button className="primary-button" disabled={busy}>{busy ? 'Надсилання…' : 'Залишити відгук'}</button>
    </form>
}

function OrdersView({ notify }: { notify: (message: string) => void }) {
    const [orders, setOrders] = useState<Order[]>([])
    const [chat, setChat] = useState<{ conversationId: string; title: string } | null>(null)
    const [reviewing, setReviewing] = useState('')
    const load = async () => { try { setOrders((await request('/api/orders')).orders) } catch (error) { notify((error as Error).message) } }
    useEffect(() => { load() }, [])
    const setStatus = async (order: Order, status: string) => {
        let reason: string | null = null
        if (status === 'cancelled') {
            reason = window.prompt('Причина скасування (обов’язково):')
            if (reason === null) return
            if (reason.trim().length < 3) { notify('Причина занадто коротка'); return }
        }
        try { await request(`/api/orders/${order.id}/status`, { method: 'PATCH', body: JSON.stringify({ status, reason }) }); notify('Статус оновлено'); load() } catch (error) { notify((error as Error).message) }
    }
    const openDispute = async (order: Order) => {
        const reason = window.prompt('Опишіть проблему для відкриття спору:')
        if (reason === null) return
        try { await request(`/api/orders/${order.id}/dispute`, { method: 'POST', body: JSON.stringify({ reason }) }); notify('Спір відкрито'); load() } catch (error) { notify((error as Error).message) }
    }
    const resolveDispute = async (order: Order, outcome: string) => {
        const resolution = window.prompt(outcome === 'completed' ? 'Рішення по спору — замовлення виконано. Опишіть умови:' : 'Рішення по спору — замовлення скасовано. Опишіть умови:')
        if (resolution === null) return
        try { await request(`/api/orders/${order.id}/dispute/resolve`, { method: 'POST', body: JSON.stringify({ outcome, resolution }) }); notify('Спір вирішено'); load() } catch (error) { notify((error as Error).message) }
    }
    const openChat = async (order: Order) => {
        try { const result = await request(`/api/orders/${order.id}/conversation`); setChat({ conversationId: result.conversation.id, title: order.conditionsSnapshot?.productTitle || 'Замовлення' }) } catch (error) { notify((error as Error).message) }
    }
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Угоди</span><h1>Замовлення</h1><p className="view-subtitle">Керуйте статусами і спілкуйтеся з другою стороною.</p></div><button className="outline-button" onClick={load}>↻ Оновити</button></div>
        <div className="order-list">{orders.map((order) => <article key={order.id} className="order-card"><header><div><span className="eyebrow">{order.buyer.username} ↔ {order.seller.username}</span><h3>{order.conditionsSnapshot?.productTitle || 'Замовлення'}</h3></div><span className="status status-active">{ORDER_STATUS[order.status] ?? order.status}</span></header>
            <div className="card-meta"><span>{order.quantity ?? '—'} {order.unit}</span><span>{formatPrice(order.price.unit ?? 0, order.price.currency)} / {order.unit}</span><span>{formatPrice(order.subtotal, order.price.currency)}</span></div>
            {order.cancelReason && <p className="form-hint">Причина скасування: {order.cancelReason}</p>}
            {order.dispute && <p className={order.dispute.status === 'open' ? 'form-error' : 'form-hint'}>Спір ({order.dispute.status}): {order.dispute.reason}{order.dispute.resolution ? ` — Рішення: ${order.dispute.resolution}` : ''}</p>}
            <div className="request-actions">
                {order.status === 'accepted' && <button className="primary-button compact" onClick={() => setStatus(order, 'in_progress')}>▶ Розпочати</button>}
                {order.status === 'in_progress' && <button className="primary-button compact" onClick={() => setStatus(order, 'completed')}>✔ Завершити</button>}
                {(order.status === 'accepted' || order.status === 'in_progress') && <button className="outline-button" onClick={() => setStatus(order, 'cancelled')}>✕ Скасувати</button>}
                {['accepted', 'in_progress', 'completed'].includes(order.status) && !order.dispute && <button className="outline-button" onClick={() => openDispute(order)}>⚠ Спір</button>}
                {order.dispute?.status === 'open' && <><button className="primary-button compact" onClick={() => resolveDispute(order, 'completed')}>Вирішити: виконано</button><button className="outline-button compact" onClick={() => resolveDispute(order, 'cancelled')}>Вирішити: скасувати</button></>}
                <button className="outline-button" onClick={() => openChat(order)}>♧ Чат</button>
                {order.status === 'completed' && <button className="outline-button" onClick={() => setReviewing(reviewing === order.id ? '' : order.id)}>★ Відгук</button>}
            </div>
            {reviewing === order.id && <ReviewForm order={order} notify={notify} onDone={() => setReviewing('')} />}
        </article>)}{!orders.length && <Empty text="Замовлень поки немає" />}</div>
        {chat && <ChatPanel chat={chat} onClose={() => setChat(null)} notify={notify} />}
    </section>
}

function ProfileView({ logout, notify }: { logout: () => void; notify: (message: string) => void }) {
    const [profile, setProfile] = useState<PrivateProfile | null>(null)
    const [visibility, setVisibility] = useState('private')
    const [consent, setConsent] = useState(false)
    const [busy, setBusy] = useState(false)
    const [message, setMessage] = useState('')
    const [editingAvatar, setEditingAvatar] = useState(false)
    const [phoneCode, setPhoneCode] = useState('')
    const [phoneCodeSent, setPhoneCodeSent] = useState(false)
    const [phoneCodeError, setPhoneCodeError] = useState('')
    const [editingPhone, setEditingPhone] = useState(false)
    const [editingEmail, setEditingEmail] = useState(false)
    const [emailCodeSent, setEmailCodeSent] = useState(false)
    const [emailCode, setEmailCode] = useState('')
    const [emailDraft, setEmailDraft] = useState('')
    const [editingPassword, setEditingPassword] = useState(false)
    const [passwordMessage, setPasswordMessage] = useState('')
    const [phoneCountry, setPhoneCountry] = useState(profile?.countryCode ?? 'UA')
    const [citySuggestions, setCitySuggestions] = useState<string[]>([])
    const searchCities = async (value: string) => { if (value.trim().length < 2) { setCitySuggestions([]); return }; try { const response = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&countrycodes=ua&accept-language=uk&limit=8&q=${encodeURIComponent(value)}`, { headers: { 'Accept-Language': 'uk' } }); const places = await response.json(); setCitySuggestions(Array.from(new Set(places.map((place: { display_name: string }) => place.display_name.split(',').slice(0, 2).join(', ')))) as string[]) } catch { setCitySuggestions([]) } }
    const loadAvatar = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { const size = 512; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const scale = Math.max(size / image.width, size / image.height); canvas.getContext('2d')?.drawImage(image, (size - image.width * scale) / 2, (size - image.height * scale) / 2, image.width * scale, image.height * scale); resolve(canvas.toDataURL('image/jpeg', .82)) }; image.onerror = reject; image.src = String(reader.result) }; reader.onerror = reject; reader.readAsDataURL(file) })
    const saveAvatar = async () => { if (!profile) return; setBusy(true); try { const result = await request('/api/profile/me', { method: 'PATCH', body: JSON.stringify({ avatarUrl: profile.avatarUrl }) }); setProfile(result.profile); setEditingAvatar(false); notify('Аватар збережено') } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
    useEffect(() => {
        request('/api/profile/me').then((result) => { setProfile(result.profile); setEmailDraft(result.profile.email ?? ''); setVisibility(result.profile.privacy.phoneVisibility); setConsent(result.profile.privacy.phoneDisclosureConsent) }).catch((error) => notify((error as Error).message))
    }, [])
    if (!profile) return <section className="content"><Empty text="Завантаження профілю…" /></section>
    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setBusy(true); setMessage('')
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        try { const result = await request('/api/profile/me', { method: 'PATCH', body: JSON.stringify({ ...(data.email !== (profile.email ?? '') ? { email: data.email } : {}), nickname: data.nickname, bio: data.bio, avatarUrl: profile.avatarUrl, location: data.location, exactAddress: data.exactAddress, phone: data.phone }) }); const privacy = await request('/api/profile/me/privacy', { method: 'PATCH', body: JSON.stringify({ phoneVisibility: visibility, phoneDisclosureConsent: consent }) }); setProfile(privacy.profile ?? result.profile); if (privacy.profile) setVisibility(privacy.profile.privacy.phoneVisibility); notify('Профіль збережено') }
        catch (caught) { setMessage((caught as Error).message) } finally { setBusy(false) }
    }
    const savePrivacy = async () => {
        setMessage('')
        try { const result = await request('/api/profile/me/privacy', { method: 'PATCH', body: JSON.stringify({ phoneVisibility: visibility, phoneDisclosureConsent: consent }) }); setProfile(result.profile); notify('Налаштування приватності збережено') }
        catch (caught) { setMessage((caught as Error).message) }
    }
    return <section className="content profile-view"><span className="eyebrow">Налаштування</span><h1>Налаштування профілю</h1>
        <div className="profile-hero"><div className="profile-rating"><span aria-label="Рейтинг">{[0,1,2,3,4].map((star) => <span key={star} className={profile.ratingSummary.average !== null && star < Math.round(profile.ratingSummary.average) ? 'star-filled' : 'star-empty'}>★</span>)}</span><b>{profile.ratingSummary.average ?? '—'}</b></div><div className="profile-avatar-wrap"><div className="profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="Аватар профілю" /> : <span>{(profile.nickname || profile.username)[0]?.toUpperCase()}</span>}</div><button type="button" className="avatar-edit" aria-label="Редагувати фото та нікнейм" onClick={() => setEditingAvatar(!editingAvatar)}>✎</button></div><strong>{profile.nickname || profile.username}</strong><small>@{profile.username}</small><div className="profile-hero-stats"><span><b>{profile.statistics.listingsCount}</b> активних товарів</span><span><b>{profile.statistics.completedDealsCount}</b> завершених угод</span><span><b>{profile.statistics.responseRate ?? '—'}%</b> відповідей</span></div>{editingAvatar && <div className="avatar-editor"><input type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const avatarUrl = await loadAvatar(file); setProfile({ ...profile, avatarUrl }) } catch { setMessage('Не вдалося прочитати зображення') } }} /><input placeholder="Або URL зображення" value={profile.avatarUrl ?? ''} onChange={(event) => setProfile({ ...profile, avatarUrl: event.target.value })} /><div className="avatar-editor-actions"><button type="button" className="primary-button compact" disabled={busy} onClick={saveAvatar}>Зберегти</button><button type="button" className="outline-button compact" onClick={() => { setEditingAvatar(false); request('/api/profile/me').then((result) => setProfile(result.profile)) }}>Скасувати</button></div></div>}</div>
        <div className="profile-stats"><span><b>{profile.statistics.listingsCount}</b><small>товарів</small></span><span><b>{profile.statistics.completedDealsCount}</b><small>угод</small></span><span><b>{profile.ratingSummary.average ?? '—'}</b><small>рейтинг ({profile.ratingSummary.count})</small></span></div>
        <form className="product-form" onSubmit={save}>
            <label>Логін<input value={profile.username} readOnly /></label>
            <label className={`phone-field ${profile.phoneVerified ? 'phone-verified' : 'phone-unverified'}`}>Телефон <span className="phone-status">({profile.phoneVerified ? 'підтверджений' : 'не підтверджений'})</span><div className="phone-display"><input value={profile.phone} readOnly /><button type="button" className="avatar-edit inline-edit" onClick={() => setEditingPhone(!editingPhone)}>✎</button></div>{editingPhone && <div className="phone-editor"><PhoneInput countryCode={phoneCountry} phone={profile.phone} onCountryCode={setPhoneCountry} onPhone={(value) => setProfile({ ...profile, phone: value })} /><button type="button" className="outline-button compact" onClick={async () => { try { setPhoneCodeError(''); setPhoneCodeSent(true); await request('/api/profile/me/phone-verification', { method: 'POST', body: JSON.stringify({ countryCode: phoneCountry, phone: profile.phone }) }); notify('Код підтвердження виведено в термінал бекенду') } catch (error) { setPhoneCodeSent(false); setMessage((error as Error).message) } }}>Підтвердити телефон</button></div>}{phoneCodeSent && <div className="verification-popup-inline"><input value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-значний код" /><button type="button" className="outline-button compact" disabled={phoneCode.length !== 6} onClick={async () => { try { await request('/api/profile/me/phone-verification/confirm', { method: 'POST', body: JSON.stringify({ code: phoneCode }) }); setPhoneCodeSent(false); setPhoneCode(''); setEditingPhone(false); notify('Телефон підтверджено') } catch (error) { setPhoneCodeError((error as Error).message) } }}>Підтвердити</button><ResendCodeButton onResend={() => request('/api/profile/me/phone-verification', { method: 'POST', body: JSON.stringify({ countryCode: phoneCountry, phone: profile.phone }) })} />{phoneCodeError && <span className="field-error">{phoneCodeError}</span>}</div>}</label>
            <label className={`email-field ${profile.emailVerified ? 'email-verified' : 'email-unverified'}`}>Електронна пошта <span className="email-status">({profile.emailVerified ? 'підтверджена' : 'не підтверджена'})</span><div className="phone-display"><input name="email" type="email" value={editingEmail ? emailDraft : (profile.email ?? '')} maxLength={254} readOnly={!editingEmail} autoFocus={editingEmail} onClick={() => setEditingEmail(true)} onChange={(event) => setEmailDraft(event.target.value)} /><button type="button" className="avatar-edit inline-edit" onClick={() => { setEditingEmail(true); setEmailDraft(profile.email ?? ''); setEmailCodeSent(false) }}>✎</button></div>{editingEmail && emailDraft.trim().toLowerCase() !== (profile.email ?? '').toLowerCase() && <button type="button" className="outline-button compact" onClick={async () => { try { await request('/api/profile/me', { method: 'PATCH', body: JSON.stringify({ email: emailDraft }) }); await request('/api/profile/me/email-verification', { method: 'POST', body: JSON.stringify({ email: emailDraft }) }); setEmailCodeSent(true); notify('Код підтвердження виведено в термінал бекенду') } catch (error) { setMessage((error as Error).message) } }}>{emailCodeSent ? 'Надіслати повторно' : 'Підтвердити email'}</button>}{emailCodeSent && <div className="verification-popup-inline"><input value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-значний код" /><button type="button" className="outline-button compact" disabled={emailCode.length !== 6} onClick={async () => { try { await request('/api/profile/me/email-verification/confirm', { method: 'POST', body: JSON.stringify({ code: emailCode }) }); setEmailCodeSent(false); setEmailCode(''); setEditingEmail(false); const result = await request('/api/profile/me'); setProfile(result.profile); setEmailDraft(result.profile.email ?? ''); notify('Email підтверджено') } catch (error) { setMessage((error as Error).message) } }}>Підтвердити код</button><ResendCodeButton onResend={() => request('/api/profile/me/email-verification', { method: 'POST', body: JSON.stringify({ email: emailDraft }) })} /></div>}</label>
            <div className="password-change"><label>Пароль<div className="phone-display"><input type="password" value="••••••••••••" readOnly aria-label="Поточний пароль прихований" /><button type="button" className="avatar-edit inline-edit" onClick={() => { setEditingPassword(!editingPassword); setPasswordMessage('') }}>✎</button></div></label>{editingPassword && <div className="password-editor"><div className="password-current-row"><PasswordInput name="currentPassword" placeholder="Поточний пароль" autoComplete="current-password" /><a href="/?reset-password">Забув пароль</a></div><PasswordInput name="newPassword" placeholder="Новий пароль" autoComplete="new-password" minLength={12} /><PasswordInput name="passwordConfirmation" placeholder="Підтвердження нового паролю" autoComplete="new-password" minLength={12} /><button type="button" className="outline-button compact" onClick={async (event) => { const box = event.currentTarget.parentElement; const currentPassword = (box?.querySelector('[name=currentPassword]') as HTMLInputElement)?.value; const newPassword = (box?.querySelector('[name=newPassword]') as HTMLInputElement)?.value; const confirmation = (box?.querySelector('[name=passwordConfirmation]') as HTMLInputElement)?.value; try { await request('/api/profile/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, confirmation }) }); setEditingPassword(false); setPasswordMessage('Пароль змінено') } catch (error) { setPasswordMessage((error as Error).message) } }}>Змінити пароль</button>{passwordMessage && <span className="field-error">{passwordMessage}</span>}</div>}</div>
            <div className="field-row">
                <label>Нікнейм<input name="nickname" defaultValue={profile.nickname ?? ''} maxLength={50} /></label>
                <label>Місто<input name="location" defaultValue={profile.location ?? ''} maxLength={120} placeholder="Почніть вводити місто" onChange={(event) => searchCities(event.target.value)} />{citySuggestions.length > 0 && <div className="city-suggestions">{citySuggestions.map((city) => <button type="button" key={city} onClick={(event) => { const input = (event.currentTarget.parentElement?.previousElementSibling as HTMLInputElement); input.value = city; setCitySuggestions([]) }}>{city}</button>)}</div>}</label>
            </div>
            <label>Про себе<textarea name="bio" defaultValue={profile.bio ?? ''} rows={3} maxLength={500} placeholder="Розкажіть про свою ферму або господарство" /></label>
            <div className="field-row">
                <label>Резервна електронна пошта<input name="recoveryEmail" type="email" defaultValue={profile.recoveryEmail ?? ''} /></label>
            </div>
            <label>Точна адреса <small className="form-hint">видима лише вам</small><input name="exactAddress" defaultValue={profile.exactAddress ?? ''} maxLength={500} /></label>
            <div className="profile-privacy">
                <strong>Видимість телефону</strong>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Не видимий нікому</option><option value="authenticated">Лише авторизованим користувачам</option><option value="public">Видимий усім</option></select>
                <label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Підтверджую згоду на розкриття номера телефону</label>
                <button type="button" className="outline-button" onClick={savePrivacy}>Зберегти приватність</button>
            </div>
            {message && <p className="form-error">{message}</p>}
            <div className="field-row"><button className="primary-button" disabled={busy}>{busy ? 'Збереження…' : 'Зберегти профіль'}</button><button type="button" className="outline-button" onClick={logout}>Вийти з акаунта</button></div>
        </form>
    </section>
}

function VerifyEmail() {
    const [message, setMessage] = useState('Натисніть кнопку, щоб підтвердити електронну пошту.')
    const [busy, setBusy] = useState(false)
    const [done, setDone] = useState(false)
    const token = useRef(new URLSearchParams(window.location.search).get('token') ?? '')
    useEffect(() => { window.history.replaceState({}, '', '/verify-email') }, [])
    return <main className="auth-page"><section className="auth-card"><h2>Підтвердження пошти</h2><p role="status">{message}</p>{!done && <button className="primary-button" disabled={busy || !token.current} onClick={async () => { setBusy(true); try { await request('/api/auth/confirm-email', { method: 'POST', body: JSON.stringify({ token: token.current }) }); setDone(true); setMessage('Електронну пошту підтверджено.') } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }}>Підтвердіть пошту</button>}<a href="/">До кабінету / входу</a></section></main>
}

export default App















