// @ts-nocheck
import { FormEvent, useEffect, useMemo, useRef, useState } from 'react'
import L from 'leaflet'
import 'leaflet/dist/leaflet.css'
import PasswordInput from './PasswordInput'
import PhoneInput from './PhoneInput'
import PasswordReset from './PasswordReset'
import ResendCodeButton from './ResendCodeButton'
import ProfileLocationFields from './ProfileLocationFields'
import type { ProfileMapLocation } from './ProfileLocationFields'
import PublicHome from './PublicHome'
import SearchLocationControls, { useSearchLocation } from './SearchLocationControls'
import SettlementSearchInput from './SettlementSearchInput'
import SettlementPicker from './SettlementPicker'
import MapListingPreview from './MapListingPreview'
import { markerKey, selectionMarkers, selectionForMarker, type MapSelection } from './map-selection'
import type { Settlement } from './settlement-model'
import Card, { ListingPicture } from './ProductCard'
import { ListingBasics, QuantityFields, CurrencyField, FieldError } from './ListingFields'
import ListingLocationFields from './ListingLocationFields'
import { addressFields, emptyAddress, validCoordinates } from './address-model'
import type { AddressValue } from './address-model'
import { unitLabel, DELIVERY_LABELS } from './listing-options'
import CategoryPicker, { CategoryImage } from './CategoryPicker'
import { categoryTrail } from './categories'
import type { Category } from './categories'
import { groupMapSellers } from './map-sellers'
import type { SellerProductPoint } from './map-sellers'
import './map-sellers.css'
import { avatarInitials, buildMapNodes, inViewport, mapStage } from './map-clusters'
import { mapMarkerElement, mapMarkerLabel } from './map-marker-icons'
import type { MapViewport } from './map-clusters'
import type { HomeCity, HomeMapProps } from './PublicHome'
import './sidebar-profile.css'

export type User = { id: string; username: string; countryCode: string; phone: string; email: string | null; emailVerified: boolean }
export type Product = { publicAddress?: string; addressVisibility?: 'private' | 'public'; mapLocationMode?: 'profile' | 'pin' | 'address' | 'approximate'; id: string; title: string; description: string; photos: { url: string; alt: string }[]; quantity: number; availableQuantity?: number; unit: string; price: { amount: number; currency: string }; deliveryMode: string; geoZone: string; address?: string | null; coordinates?: MapPoint | null; status: string; owner: { id: string; username?: string }; category: { id: string; name: string } }
type View = 'home' | 'find' | 'products' | 'map' | 'mine' | 'create' | 'request' | 'requests' | 'market' | 'orders' | 'messages' | 'notifications' | 'profile'
type MapPoint = { latitude: number; longitude: number }
type MapMarker = SellerProductPoint & { approximate: boolean }
type BuyRequest = { id: string; title: string; description: string; addressVisibility?: 'private' | 'public'; mapLocationMode?: 'profile' | 'pin' | 'address' | 'approximate'; geoArea: string; category: { name: string }; quantity: number; fulfilledQuantity: number; unit: string; status: string; coordinates: MapPoint | null; buyer?: { id: string; username: string }; price: { min: number | null; max: number | null; currency: string }; delivery: { required: boolean; preferred: string | null }; deadline: string | null }
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

function Auth({ onLogin, initialRegister = false }: { onLogin: (user: User) => void; initialRegister?: boolean }) {
    const [registered, setRegistered] = useState<{ user: User; sent: boolean } | null>(null)
    const [register, setRegister] = useState(initialRegister)
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
    return <main className="auth-page"><div className="auth-story"><div className="brand"><img className="brand-logo" src="/brand/logo-full.png" alt="ДещоТреба" /></div><span className="eyebrow">Маркетплейс поруч</span><h1>Продавайте те,<br /><em>що росте.</em></h1><p>Агропродукція від своїх. Чесно, локально, без зайвих кроків.</p></div><section className="auth-card"><span className="eyebrow">Ласкаво просимо</span><h2>{register ? 'Створіть акаунт' : 'З поверненням'}</h2><p>{register ? 'Почніть продавати врожай поруч.' : 'Увійдіть, щоб керувати товарами.'}</p><div className="auth-tabs"><button type="button" className={!register ? 'selected' : ''} onClick={() => { setRegister(false); setError(''); setFieldErrors({}) }}>Увійти</button><button type="button" className={register ? 'selected' : ''} onClick={() => { setRegister(true); setError(''); setFieldErrors({}) }}>Реєстрація</button></div><form onSubmit={submit}><label className={fieldErrors.username ? 'field-invalid' : ''}>{register ? 'Логін' : 'Логін, електронна пошта'}<input name="username" autoComplete="username" required minLength={register ? 3 : 1} maxLength={register ? 32 : 254} />{register && <small>3–32 символи: латиниця, цифри, _, ., -</small>}{fieldError('username')}</label>{register && <label>Електронна пошта<input name="email" type="email" autoComplete="email" required maxLength={254} />{fieldError('email')}</label>}{register && <PhoneInput countryCode={countryCode} phone={phone} onCountryCode={(code) => { setCountryCode(code); setFieldErrors((current) => ({ ...current, countryCode: '' })) }} onPhone={(value) => { setPhone(value); setFieldErrors((current) => ({ ...current, phone: '' })) }} error={fieldErrors.phone ?? fieldErrors.countryCode} />}<label className={fieldErrors.password ? 'field-invalid' : ''}>Пароль<PasswordInput name="password" autoComplete={register ? 'new-password' : 'current-password'} required />{fieldError('password')}</label>{!register && <button type="button" className="text-button" onClick={() => setResetMode(true)}>Не пам’ятаю пароль</button>}{register && <label className={fieldErrors.passwordConfirmation ? 'field-invalid' : ''}>Підтвердження пароля<PasswordInput name="passwordConfirmation" autoComplete="new-password" required />{fieldError('passwordConfirmation')}</label>}{error && <p className="form-error" role="alert">{error}</p>}<button className="primary-button" disabled={busy}>{busy ? 'Зачекайте...' : register ? 'Створити акаунт' : 'Увійти в акаунт'} <span>→</span></button></form></section></main>
}

function Empty({ text, action, onAction }: { text: string; action?: string; onAction?: () => void }) { return <div className="empty-state"><span>✦</span><h3>{text}</h3>{action && <button className="primary-button compact" onClick={onAction}>{action}</button>}</div> }
function Pagination({ page, pages, onPage }: { page: number; pages: number; onPage: (page: number) => void }) { return pages > 1 ? <div className="pagination"><button disabled={page === 1} onClick={() => onPage(page - 1)}>←</button><span>{page} / {pages}</span><button disabled={page === pages} onClick={() => onPage(page + 1)}>→</button></div> : null }

function MapView({ categories, openProduct, openRequest, openProfile, notify, city, userId, locationReady = true, sharedCategoryId, onCategoryChange, onResultsChange }: { categories: Category[]; openProduct: (product: Product) => void; openRequest: (id: string) => void; openProfile: (username: string) => void; notify: (message: string) => void; city?: HomeCity } & Partial<HomeMapProps>) {
    const location = useSearchLocation(request, userId, city, locationReady)
    const [pickingPoint, setPickingPoint] = useState(false)
    const searchCity = location.city
    const homeLocation = useMemo(() => validCoordinates(location.address.coordinates) ? { ...location.address.coordinates, city: location.address.city } : null, [location.address])
    const [searchScope, setSearchScope] = useState<'city' | 'nearby' | 'area' | 'country'>('city')
    const mapElement = useRef<HTMLDivElement>(null)
    const mapInstance = useRef<L.Map | null>(null)
    const markerLayer = useRef<L.LayerGroup | null>(null)
    const markerElements = useRef(new Map<string, HTMLElement>())
    const summaryElement = useRef<HTMLElement>(null)
    const [center, setCenter] = useState<MapPoint>(city ?? { latitude: 50.45, longitude: 30.52 })
    const [radius, setRadius] = useState(2)
    const [nearbyRadius, setNearbyRadius] = useState(5)
    const [zoom, setZoom] = useState(city ? 12 : 10)
    const [geoZone, setGeoZone] = useState('')
    const [geoSettlement, setGeoSettlement] = useState<Settlement | null>(null)
    const [localCategoryId, setLocalCategoryId] = useState('')
    const categoryId = sharedCategoryId ?? localCategoryId
    const setCategoryId = (id: string) => { setLocalCategoryId(id); onCategoryChange?.(id) }
    const [showProducts, setShowProducts] = useState(true)
    const [showBuyRequests, setShowBuyRequests] = useState(true)
    const [markers, setMarkers] = useState<MapMarker[]>([])
    const [fetching, setLoading] = useState(true)
    const [loadedKey, setLoadedKey] = useState('')
    const [error, setError] = useState('')
    const [mapQuery, setMapQuery] = useState('')
    const [mapSearch, setMapSearch] = useState('')
    const [searchIn, setSearchIn] = useState<'title' | 'all' | 'owner'>('title')
    const [searchRevision, setSearchRevision] = useState(0)
    const [focusRevision, setFocusRevision] = useState(0)
    const displayMode = 'sellers' as const
    const [viewport, setViewport] = useState<MapViewport | null>(null)
    const [expanded, setExpanded] = useState(false)
    const [selection, updateSelection] = useState<MapSelection | null>(null)
    const [activeMarkerKey, setActiveMarkerKey] = useState<string | null>(null)
    const [previewDetail, setPreviewDetail] = useState<{ key: string; description?: string; loading: boolean; error?: string } | null>(null)
    const setSelection = (next: MapSelection | null) => { updateSelection(next); if (!next) setActiveMarkerKey(null) }
    const [resultPage, setResultPage] = useState(1)
    const [sellerProfile, setSellerProfile] = useState<PublicProfile | null>(null)
    const [sellerProfileLoading, setSellerProfileLoading] = useState(false)
    useEffect(() => { setSelection(null); setGeoZone(''); setGeoSettlement(null); setFocusRevision(0); setSearchScope(searchCity ? 'city' : 'country') }, [searchCity?.name, searchCity?.settlement?.code, searchCity?.latitude, searchCity?.longitude])
    const filtered = Boolean(categoryId || mapSearch)
    const searchOrigin = searchScope === 'nearby' ? homeLocation ?? searchCity ?? center : searchCity ?? center
    const requestKey = JSON.stringify([searchScope, searchCity?.name ?? '', searchCity?.settlement?.code ?? '', searchOrigin.latitude, searchOrigin.longitude, homeLocation?.latitude, homeLocation?.longitude, radius, nearbyRadius, location.busy, showProducts, showBuyRequests, categoryId, geoZone, geoSettlement?.code, mapSearch, searchIn, searchRevision, center.latitude, center.longitude, zoom, viewport?.south, viewport?.north, viewport?.west, viewport?.east])
    const pending = mapQuery.trim() !== mapSearch || loadedKey !== requestKey
    const loading = fetching || pending
    const categoryById = useMemo(() => new Map(categories.map((item) => [item.id, item])), [categories])
    const areaMarkers = useMemo(() => pending ? [] : searchScope === 'nearby' ? markers : viewport ? markers.filter((item) => inViewport(item, viewport)) : [], [markers, viewport, pending, searchScope])
    const areaProducts = useMemo(() => areaMarkers.filter((item) => item.kind === 'product'), [areaMarkers])
    const sellers = useMemo(() => groupMapSellers(areaProducts), [areaProducts])
    const scopedMarkers = useMemo(() => selectionMarkers(selection, markers, areaMarkers), [markers, areaMarkers, selection])
    const activeMarker = scopedMarkers.find(item => markerKey(item) === activeMarkerKey) ?? null
    const displayMarkers = useMemo(() => {
        const points = new Map(areaMarkers.map(item => [markerKey(item), item]))
        if (selection && viewport) for (const item of scopedMarkers) if (inViewport(item, viewport)) points.set(markerKey(item), item)
        return [...points.values()]
    }, [areaMarkers, scopedMarkers, selection, viewport])
    const showSellerList = !selection && (displayMode === 'sellers' || (displayMode === 'adaptive' && !filtered))
    const resultItems = useMemo(() => showSellerList ? [...sellers, ...areaMarkers.filter((item) => item.kind === 'buyRequest')] : scopedMarkers, [showSellerList, sellers, areaMarkers, scopedMarkers])
    const pageSize = selection ? 8 : 20
    const resultPages = Math.max(1, Math.ceil(resultItems.length / pageSize))
    const activePage = Math.min(resultPage, resultPages)
    const visibleResults = useMemo(() => resultItems.slice((activePage - 1) * pageSize, activePage * pageSize), [resultItems, activePage, pageSize])
    const selectedIds = useMemo(() => new Set<string>(selection ? visibleResults.map((item) => item.id) : []), [selection, visibleResults])
    const stage = mapStage(zoom, viewport?.width ?? 0, viewport?.height ?? 0)
    const selectionOwner = selection && scopedMarkers.length && scopedMarkers.every(item => item.owner?.id === scopedMarkers[0].owner?.id) ? scopedMarkers[0].owner : null
    const scope = selection ? selectionOwner?.nickname || selectionOwner?.username || 'Обрана точка' : ''
    useEffect(() => { onResultsChange?.({ markers: scopedMarkers, loading, error, query: mapSearch, scope }) }, [onResultsChange, scopedMarkers, loading, error, mapSearch, scope])
    const categorySuggestions = useMemo(() => {
        const counts = new Map<string, { category: Category; count: number }>()
        for (const marker of scopedMarkers) {
            const trail = categoryTrail(categories, marker.category.id, categoryById)
            const index = categoryId ? trail.findIndex((item) => item.id === categoryId) + 1 : 0
            const category = trail[index]
            if (!category || category.id === categoryId) continue
            const current = counts.get(category.id) ?? { category, count: 0 }
            current.count++; counts.set(category.id, current)
        }
        return [...counts.values()].sort((a, b) => b.count - a.count || a.category.name.localeCompare(b.category.name, 'uk')).slice(0, 8)
    }, [scopedMarkers, categories, categoryById, categoryId])

    useEffect(() => {
        const timer = window.setTimeout(() => setMapSearch(mapQuery.trim()), 300)
        return () => window.clearTimeout(timer)
    }, [mapQuery])
    useEffect(() => { setResultPage(1) }, [categoryId, mapSearch, selection])
    useEffect(() => { setSelection(null); setResultPage(1) }, [categoryId, mapSearch, geoZone, geoSettlement?.code, showProducts, showBuyRequests, searchIn])
    useEffect(() => {
        if (!activeMarker) { setPreviewDetail(null); return }
        const controller = new AbortController(), key = markerKey(activeMarker)
        setPreviewDetail({ key, loading: true })
        request(`/api/${activeMarker.kind === 'product' ? 'products' : 'buy-requests'}/${activeMarker.id}`, { signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) setPreviewDetail({ key, loading: false, description: (result.product ?? result.buyRequest)?.description }) })
            .catch(error => { if (!controller.signal.aborted) setPreviewDetail({ key, loading: false, error: 'Не вдалося завантажити опис. Основні дані показані нижче.' }) })
        return () => controller.abort()
    }, [activeMarker?.id, activeMarker?.kind])
    useEffect(() => {
        const controller = new AbortController()
        setSellerProfile(null); setSellerProfileLoading(Boolean(selectionOwner))
        if (selectionOwner) request('/api/profiles/' + encodeURIComponent(selectionOwner.username), { signal: controller.signal })
            .then(result => { if (!controller.signal.aborted) setSellerProfile(result.profile) })
            .catch(() => { /* The owner name and listings remain available. */ })
            .finally(() => { if (!controller.signal.aborted) setSellerProfileLoading(false) })
        return () => controller.abort()
    }, [selectionOwner?.username])
    useEffect(() => {
        const escape = (event: KeyboardEvent) => {
            if (event.key !== 'Escape') return
            if (selection) setSelection(null)
            else setExpanded(false)
        }
        window.addEventListener('keydown', escape)
        return () => window.removeEventListener('keydown', escape)
    }, [selection])
    useEffect(() => {
        if (!expanded) return
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = previous }
    }, [expanded])

    useEffect(() => {
        if (!viewport || location.busy) return
        const controller = new AbortController()
        setLoading(true); setError('')
        const timer = window.setTimeout(async () => {
            const origin = searchScope === 'area' ? center : searchOrigin
            const activeRadius = searchScope === 'nearby' ? nearbyRadius : radius
            const params = new URLSearchParams({ latitude: String(origin.latitude), longitude: String(origin.longitude), radiusKm: String(activeRadius), zoom: String(zoom), showProducts: String(showProducts), showBuyRequests: String(showBuyRequests) })
            if (searchScope === 'nearby') params.set('nearby', 'true')
            const initialSearch = focusRevision === 0
            if (!initialSearch && searchScope !== 'nearby') for (const key of ['south', 'north', 'west', 'east'] as const) params.set(key, String(viewport[key]))
            if (searchScope === 'country') params.set('nationwide', 'true')
            if (searchScope === 'city' && searchCity) { params.set('cityName', searchCity.name); if (searchCity.settlement?.code) params.set('settlementCode', searchCity.settlement.code); params.set('cityOutsideKm', String(radius)) }
            if (geoZone.trim()) params.set('geoZone', geoZone.trim())
            if (geoSettlement) params.set('geoSettlementCode', geoSettlement.code)
            if (mapSearch) params.set('q', mapSearch)
            params.set('searchIn', searchIn)
            if (searchIn === 'owner' && searchScope !== 'nearby') params.set('includeOwnerListings', 'true')
            if (categoryId) params.set('categoryId', categoryId)
            try {
                const result = await request('/api/map/markers?' + params, { signal: controller.signal })
                if (!controller.signal.aborted) {
                    setMarkers(result.markers); setLoadedKey(requestKey)
                    const map = mapInstance.current
                    if (map && searchScope !== 'nearby' && initialSearch) {
                        const points = result.markers
                        const origin = searchScope === 'city' && searchCity ? [searchCity.latitude, searchCity.longitude] as [number, number] : [49.0, 31.0] as [number, number]
                        if (!points.length && searchScope === 'city' && searchCity) map.setView(origin, 12, { animate: false })
                        else {
                            const bounds = points.length ? L.latLngBounds(points.map((item) => [item.latitude, item.longitude])) : L.latLngBounds([[44, 22], [52.5, 40.5]])
                            if (searchScope === 'city') bounds.extend(origin)
                            map.fitBounds(bounds, { padding: [55, 55], maxZoom: searchScope === 'city' ? 12 : 7, animate: false })
                        }
                        setFocusRevision((value) => value + 1)
                    } else if (map && searchScope === 'nearby' && homeLocation && initialSearch) {
                        const points = result.markers.map((item) => [item.latitude, item.longitude] as [number, number])
                        if (points.length) map.fitBounds(L.latLngBounds([[homeLocation.latitude, homeLocation.longitude], ...points]), { padding: [55, 55], maxZoom: 15, animate: false })
                        else map.setView([homeLocation.latitude, homeLocation.longitude], 13)
                        setFocusRevision((value) => value + 1)
                    }
                }
            } catch (caught) {
                if (!controller.signal.aborted) { setError((caught as Error).message); setMarkers([]); setLoadedKey(requestKey) }
            } finally { if (!controller.signal.aborted) setLoading(false) }
        }, 120)
        return () => { window.clearTimeout(timer); controller.abort() }
    }, [requestKey, focusRevision])


    useEffect(() => {
        if (!mapElement.current || mapInstance.current) return
        const map = L.map(mapElement.current, { zoomControl: true, attributionControl: true, minZoom: 3, maxZoom: 19, worldCopyJump: true }).setView([center.latitude, center.longitude], zoom)
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map)
        markerLayer.current = L.layerGroup().addTo(map)
        const updateViewport = () => {
            const bounds = map.getBounds(), size = map.getSize()
            const wrap = (value: number) => ((value + 180) % 360 + 360) % 360 - 180
            const fullWorld = bounds.getEast() - bounds.getWest() >= 360
            setViewport({ south: Math.max(-90, bounds.getSouth()), north: Math.min(90, bounds.getNorth()), west: fullWorld ? -180 : wrap(bounds.getWest()), east: fullWorld ? 180 : wrap(bounds.getEast()), width: size.x, height: size.y })
            const point = map.getCenter().wrap()
            setCenter({ latitude: Number(point.lat.toFixed(5)), longitude: Number(point.lng.toFixed(5)) })
            setZoom(map.getZoom())
        }
        map.on('moveend resize', updateViewport)
        mapInstance.current = map
        updateViewport()
        const observer = new ResizeObserver(() => map.invalidateSize({ pan: false }))
        observer.observe(mapElement.current)
        return () => { observer.disconnect(); map.remove(); mapInstance.current = null; markerLayer.current = null }
    }, [])

    useEffect(() => {
        const map = mapInstance.current
        if (!map || !pickingPoint) return
        const choose = (event: L.LeafletMouseEvent) => {
            const point = event.latlng.wrap()
            location.choosePoint({ latitude: Number(point.lat.toFixed(6)), longitude: Number(point.lng.toFixed(6)) })
            setPickingPoint(false)
            setFocusRevision(0); setSelection(null)
        }
        const cancel = (event: KeyboardEvent) => { if (event.key === 'Escape') setPickingPoint(false) }
        map.on('click', choose)
        window.addEventListener('keydown', cancel)
        return () => { map.off('click', choose); window.removeEventListener('keydown', cancel) }
    }, [pickingPoint, location.choosePoint])

    useEffect(() => {
        const map = mapInstance.current
        if (!map) return
        const current = map.getCenter().wrap()
        if (Math.abs(current.lat - center.latitude) > 0.00001 || Math.abs(current.lng - center.longitude) > 0.00001 || map.getZoom() !== zoom) map.setView([center.latitude, center.longitude], zoom)
    }, [center.latitude, center.longitude, zoom])

    const openMarker = async (marker: MapMarker) => {
        try {
            if (marker.kind === 'product') openProduct((await request('/api/products/' + marker.id)).product)
            else openRequest(marker.id)
        } catch (caught) { notify((caught as Error).message) }
    }
    const revealSummary = () => {
        summaryElement.current?.scrollTo({ top: 0, behavior: 'smooth' })
        if (window.matchMedia('(max-width: 760px)').matches) summaryElement.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    }
    const showMarkerPreview = (item: MapMarker, fromList = false) => {
        setSelection(selectionForMarker(item, selection)); setActiveMarkerKey(markerKey(item))
        if (fromList) {
            const map = mapInstance.current
            if (map && !map.getBounds().contains([item.latitude, item.longitude])) map.panTo([item.latitude, item.longitude])
            if (window.matchMedia('(max-width: 760px)').matches) mapElement.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
        } else revealSummary()
    }
    const showGroupPreview = (items: MapMarker[]) => {
        setSelection({ ids: items.map(item => item.id), items }); setActiveMarkerKey(null); setResultPage(1); revealSummary()
    }
    const openSeller = (owner: NonNullable<MapMarker['owner']>, kind: 'product' | 'buyRequest' = 'product') => {
        const points = markers.filter(item => item.owner?.id === owner.id && item.kind === kind)
        setSelection({ ownerId: owner.id, kind, items: points }); setActiveMarkerKey(null); setResultPage(1); revealSummary()
        if (points.length) mapInstance.current?.fitBounds(L.latLngBounds(points.map(point => [point.latitude, point.longitude])), { padding: [55, 55], maxZoom: points.length === 1 ? 14 : 16 })
    }
    useEffect(() => {
        const map = mapInstance.current, layer = markerLayer.current
        if (!map || !layer || !viewport) return
        layer.clearLayers(); markerElements.current.clear()
        const nodes = buildMapNodes(displayMarkers, (item) => map.latLngToContainerPoint([item.latitude, item.longitude]), {
            zoom, width: viewport.width, height: viewport.height, filtered, mode: displayMode, selectedIds,
            reservedPoints: homeLocation ? [map.latLngToContainerPoint([homeLocation.latitude, homeLocation.longitude])] : [],
        })
        for (const node of nodes) {
            const location = map.containerPointToLatLng([node.x, node.y])
            const focused = node.items.some((item) => activeMarkerKey ? markerKey(item) === activeMarkerKey : selectedIds.has(item.id))
            if (node.displaced) {
                L.polyline([[node.latitude, node.longitude], location], { color: focused ? '#17825a' : '#607d73', weight: focused ? 1.5 : 1, opacity: .55, interactive: false, dashArray: '3 3' }).addTo(layer)
                L.circleMarker([node.latitude, node.longitude], { radius: 2, color: '#607d73', weight: 1, fillOpacity: 1, interactive: false }).addTo(layer)
            }
            const element = mapMarkerElement(node, imageUrl)
            if (focused) element.classList.add('map-pin-selected')
            const label = mapMarkerLabel(node)
            const marker = L.marker(location, {
                icon: L.divIcon({ className: 'map-adaptive-wrap', html: element, iconSize: [node.size, node.size], iconAnchor: [node.size / 2, node.size / 2] }),
                title: label, alt: label, keyboard: true, zIndexOffset: focused ? 1000 : 0,
            })
            const tooltip = document.createElement('span')
            tooltip.textContent = label
            marker.bindTooltip(tooltip)
            marker.on('click', () => {
                if (node.type === 'product' || node.type === 'request') { showMarkerPreview(node.items[0]); return }
                showGroupPreview(node.items)
                if (node.type === 'seller' && node.items[0].owner) {
                    const points = markers.filter(item => item.owner?.id === node.items[0].owner.id && item.kind === node.items[0].kind)
                    if (points.length) map.fitBounds(L.latLngBounds(points.map(point => [point.latitude, point.longitude])), { padding: [55, 55], maxZoom: points.length === 1 ? 14 : 16 })
                    return
                }
                if (node.type === 'cluster' && zoom < 19) map.setView([node.latitude, node.longitude], Math.min(19, zoom + 2))
            })
            marker.addTo(layer)
            for (const item of node.items) markerElements.current.set(item.id, element)
        }
        if (homeLocation) L.marker([homeLocation.latitude, homeLocation.longitude], { zIndexOffset: 2000, title: 'Ваша адреса пошуку', icon: L.divIcon({ className: 'home-map-marker', html: '⌂', iconSize: [34, 34], iconAnchor: [17, 17] }) }).bindTooltip('Ваша адреса пошуку · видима лише вам').addTo(layer)
    }, [displayMarkers, homeLocation, displayMode, zoom, stage, viewport, filtered, selectedIds, activeMarkerKey, selection, resultPages])

    const highlight = (ids: string[], active: boolean) => {
        for (const id of ids) markerElements.current.get(id)?.classList.toggle('map-pin-highlight', active)
    }
    const runSearch = (scope: 'city' | 'nearby') => {
        if (scope === 'nearby' && !homeLocation) { notify('Спочатку оберіть адресу пошуку або натисніть «Моє місце».'); return }
        setSearchScope(scope === 'nearby' ? 'nearby' : searchCity ? scope : 'country'); setMapSearch(mapQuery.trim()); setGeoZone(''); setGeoSettlement(null); setFocusRevision(0); setSearchRevision(value => value + 1); setSelection(null); setResultPage(1)
    }
    const clearFilters = () => { setMapQuery(''); setMapSearch(''); setCategoryId(''); setGeoZone(''); setGeoSettlement(null); setSelection(null); setResultPage(1) }
    const chooseCategory = (id: string) => { setCategoryId(id); if (selection?.ids) setSelection(null) }
    const renderAvatar = (owner: MapMarker['owner']) => <span className="map-user-avatar" aria-hidden="true">{avatarInitials(owner)}{owner?.avatarUrl && <img src={imageUrl(owner.avatarUrl)} alt="" onError={(event) => { event.currentTarget.hidden = true }} />}</span>
    const guidance = selection
        ? 'Оберіть короткий опис — відповідна точка виділиться на мапі. Повна інформація відкривається окремою кнопкою.'
        : filtered
            ? 'Кожна картинка категорії — окреме оголошення. Наблизьте мапу, щоб побачити фото. Аватар із числом відкриває кілька оголошень одного продавця.'
            : 'Оберіть категорію або введіть назву, щоб бачити окремі товари. Аватар із числом показує продавця з кількома товарами.'
    return <section className="content map-view">
        <div className="view-header"><div><span className="eyebrow">Орієнтир</span><h1>Мапа поруч</h1><p className="view-subtitle">Знайдіть товар у місті, поруч з адресою або по всій Україні.</p></div></div>
        <div className={'map-layout map-discovery-layout ' + (expanded ? 'map-layout-expanded' : '')}>
            <div className="map-search-controls">
                <form className="map-search-row" role="search" onSubmit={(event) => { event.preventDefault(); runSearch('city') }}>
                    <label className="map-search-main"><span>{searchIn === 'owner' ? 'Продавець або покупець' : searchCity ? 'Пошук товару в місті' : 'Пошук товару по Україні'}</span><input type="search" value={mapQuery} maxLength={160} onChange={(event) => { setMapQuery(event.target.value); setSelection(null) }} placeholder={searchIn === 'owner' ? 'Ім’я або логін' : 'Наприклад, велосипед Trek'} /></label>
                    <CategoryPicker categories={categories} value={categoryId} onChange={chooseCategory} allowAll className="map-search-category" label="Категорія" />
                    <SettlementSearchInput value={searchCity} onChange={location.chooseCity} onRegionChange={region => { setGeoZone(region ?? ''); setGeoSettlement(null); if (region) location.chooseCity(null) }} />
                    {searchCity && <label className="map-search-radius"><span>За межі міста: <b>{radius} км</b><input type="number" min="1" max="100" value={radius} aria-label="Кілометри за межі міста" onChange={(event) => { const value = Math.max(1, Math.min(100, Number(event.target.value) || 1)); setRadius(value); setSearchScope('city'); setSelection(null) }} /></span><input type="range" min="1" max="100" value={radius} onChange={(event) => { setRadius(Number(event.target.value)); setSearchScope('city'); setSelection(null) }} /></label>}
                    <button type="submit" className="primary-button" disabled={location.busy}>Знайти</button>
                </form>
                <SearchLocationControls location={location} pickingPoint={pickingPoint} onPickPoint={() => setPickingPoint(value => !value)} hideCity nearbyRadius={nearbyRadius} setNearbyRadius={value => { setNearbyRadius(value); if (searchScope === 'nearby') { setFocusRevision(0); setSelection(null) } }} onNearby={() => runSearch('nearby')} nearbyDisabled={location.busy || !homeLocation} nearbyTitle={homeLocation ? 'Найближчі товари з центром біля будиночка' : 'Оберіть адресу, поставте точку на мапі або натисніть «Моє місце»'} />
                <p className="map-search-hint" role="status">{searchScope === 'nearby' ? `Поруч з будиночком у радіусі ${nearbyRadius} км.` : searchScope === 'city' ? `Пошук у ${searchCity?.name} і до ${radius} км за межами міста.` : searchScope === 'country' ? 'Місто не обрано — пошук по всій Україні.' : 'Пошук у видимій області та вибраному радіусі.'}{!loading && searchScope !== 'area' && ` Знайдено: ${markers.length}.`}{searchCity && !homeLocation && ' Для пошуку поруч оберіть адресу або поставте точку на мапі.'}</p>
                <div className="map-filter-row">
                    <div className="map-toggles"><label><input type="checkbox" checked={showProducts} onChange={(event) => { setShowProducts(event.target.checked); setSelection(null) }} /> Продавці</label><label><input type="checkbox" checked={showBuyRequests} onChange={(event) => { setShowBuyRequests(event.target.checked); setSelection(null) }} /> Запити покупців</label></div>
                    {(filtered || geoZone || geoSettlement) && <button type="button" className="text-button" onClick={clearFilters}>Скинути фільтри</button>}
                </div>
                <div className="map-active-filters">
                    {categoryId && <button type="button" onClick={() => setCategoryId('')}>{categoryById.get(categoryId)?.name} ×</button>}
                    {mapSearch && <button type="button" onClick={() => { setMapQuery(''); setMapSearch('') }}>«{mapSearch}» ×</button>}
                    {selection && <button type="button" onClick={() => setSelection(null)}>{selectionOwner?.nickname || selectionOwner?.username || 'Обрана точка'} ×</button>}
                </div>
                {!filtered && !selection && <p className="map-search-hint">Шукаєте конкретний товар? Оберіть категорію або введіть назву — точки стануть детальнішими.</p>}
            </div>
            <div className="map-canvas-wrapper">
                <div ref={mapElement} className={'map-canvas' + (pickingPoint ? ' map-picking-point' : '')} aria-label="Мапа товарів, продавців та запитів" />
                <span className="map-stage-label">{stage === 'count' ? 'Огляд району' : filtered || selection || displayMode === 'products' ? 'Окремі оголошення' : 'Продавці поруч'}</span>
                <button type="button" className="map-expand-button" onClick={() => setExpanded((value) => !value)} aria-pressed={expanded}>{expanded ? '↙ Згорнути' : '⛶ Розгорнути'}</button>
                {loading && <span className="map-status" role="status">Оновлюємо результати…</span>}
                {!loading && !areaMarkers.length && <span className="map-status">{!showProducts && !showBuyRequests ? 'Увімкніть продавців або запити покупців' : 'Нічого не знайдено. Змініть пошук або перемістіть мапу.'}</span>}
                <span className="map-displacement-note">Лінія з’єднує оголошення з його місцем</span>
            </div>
            <aside ref={summaryElement} tabIndex={-1} className="map-summary" aria-label="Результати пошуку на мапі" aria-busy={loading}>
                <div className="map-summary-heading"><span className="eyebrow">{selection ? 'Обрана точка' : 'У видимій області'}</span>{selection && <button type="button" className="text-button" onClick={() => setSelection(null)}>← Усі результати</button>}</div>
                {activeMarker && <MapListingPreview item={activeMarker} description={previewDetail?.key === activeMarkerKey ? previewDetail.description : undefined} loading={!previewDetail || previewDetail.key !== activeMarkerKey || previewDetail.loading} error={previewDetail?.key === activeMarkerKey ? previewDetail.error : undefined} imageUrl={imageUrl} onOpen={() => openMarker(activeMarker)} onOwner={() => activeMarker.owner && openProfile(activeMarker.owner.username)} onMap={() => { const map = mapInstance.current; if (map && !map.getBounds().contains([activeMarker.latitude, activeMarker.longitude])) map.panTo([activeMarker.latitude, activeMarker.longitude]); mapElement.current?.scrollIntoView({ behavior: 'smooth', block: 'center' }); highlight([activeMarker.id], true) }} />}
                {!activeMarker && (sellerProfileLoading || sellerProfile) && <section className="map-seller-profile" aria-live="polite">
                    {sellerProfileLoading ? <p>Завантажуємо профіль продавця…</p> : sellerProfile && <><div>{renderAvatar(sellerProfile)}<span><strong>{sellerProfile.nickname || sellerProfile.username}</strong><small>@{sellerProfile.username}</small></span></div>{sellerProfile.bio && <p>{sellerProfile.bio}</p>}<small>{sellerProfile.exactAddress || sellerProfile.location || 'Місце не вказано'}</small><small>{sellerProfile.statistics.listingsCount} оголошень · {sellerProfile.ratingSummary.count ? `рейтинг ${sellerProfile.ratingSummary.average}` : 'ще без відгуків'}</small><button type="button" className="outline-button compact" onClick={() => openProfile(sellerProfile.username)}>Відкрити профіль →</button></>}
                </section>}
                <h2>{selection ? activeMarker && scopedMarkers.length === 1 ? 'Обране оголошення' : selectionOwner?.nickname || selectionOwner?.username || 'Оголошення в цій точці' : showProducts ? areaProducts.length + ' товарів' : areaMarkers.length + ' запитів'}</h2>
                <p className="map-result-count">{selection ? scopedMarkers.length + ' оголошень за вашим пошуком' : sellers.length + ' продавців · ' + (areaMarkers.length - areaProducts.length) + ' запитів'}</p>
                <button type="button" className="map-back-to-map text-button" onClick={() => mapElement.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })}>↑ До мапи</button>
                <p>{guidance}</p>
                {categorySuggestions.length > 0 && <div className="map-category-suggestions"><strong>{categoryId ? 'Уточнити підкатегорію' : 'Категорії в цій області'}</strong><div>{categorySuggestions.map(({ category, count }) => <button type="button" key={category.id} onClick={() => chooseCategory(category.id)}><CategoryImage category={category} /><span>{category.name}</span><b>{count}</b></button>)}</div></div>}
                {selection && !scopedMarkers.length && !loading && <p>У цього продавця або в цій точці немає оголошень за поточними фільтрами та межами мапи.</p>}
                {error && <p className="form-error" role="alert">{error}</p>}
                <div className="map-result-list">{visibleResults.map((item) => {
                    if ('products' in item) {
                        const owner = item.products[0].owner
                        return <button key={'seller-' + item.id} className="map-result" onClick={() => owner && openSeller(owner)} onMouseEnter={() => highlight(item.products.map((product) => product.id), true)} onMouseLeave={() => highlight(item.products.map((product) => product.id), false)} onFocus={() => highlight(item.products.map((product) => product.id), true)} onBlur={() => highlight(item.products.map((product) => product.id), false)}>
                            {renderAvatar(owner)}<span><strong>{owner?.nickname || item.username}</strong><small>{item.products.length} товарів · {item.products[0]?.publicAddress || item.geoZone}</small><small>Показати товари на мапі →</small></span>
                        </button>
                    }
                    const category = categoryById.get(item.category.id)
                    return <div className={'map-listing-result ' + (markerKey(item) === activeMarkerKey ? 'map-listing-active' : '')} key={item.kind + '-' + item.id}>
                        <button type="button" className="map-result" aria-pressed={markerKey(item) === activeMarkerKey} onClick={() => showMarkerPreview(item, true)} onMouseEnter={() => highlight([item.id], true)} onMouseLeave={() => highlight([item.id], false)} onFocus={() => highlight([item.id], true)} onBlur={() => highlight([item.id], false)}>
                            <span className="map-result-picture">{category && <CategoryImage category={category} />}{item.photoUrl && <img src={imageUrl(item.photoUrl)} alt="" loading="lazy" onError={(event) => { event.currentTarget.hidden = true }} />}</span>
                            <span><strong>{item.kind === 'buyRequest' ? 'Шукає: ' : ''}{item.title}</strong>{item.price && <b className="map-listing-price">{formatPrice(item.price.amount, item.price.currency)}{item.unit ? ' / ' + unitLabel(item.unit) : ''}</b>}<small>{item.category.name}</small>{item.quantity !== undefined && <small>{item.quantity} {unitLabel(item.unit)}</small>}<small>{item.distanceBand} · {item.publicAddress || item.geoZone}</small>{item.approximate === false && <small>Публічне місце продавця</small>}</span>
                        </button>
                        <div className="map-listing-actions"><button type="button" onClick={() => openMarker(item)}>{item.kind === 'product' ? 'Відкрити товар' : 'Відкрити запит'} →</button>{item.owner && <button type="button" onClick={() => openProfile(item.owner.username)}>Профіль {item.kind === 'product' ? 'продавця' : 'покупця'} →</button>}</div>
                    </div>
                })}</div>
                {resultPages > 1 && <div className="map-result-pagination"><button disabled={activePage <= 1} onClick={() => setResultPage(activePage - 1)}>← Назад</button><span>{activePage} / {resultPages}</span><button disabled={activePage >= resultPages} onClick={() => setResultPage(activePage + 1)}>Далі →</button></div>}
                <div className="map-legend"><span><i className="legend-product" /> Товари продавців</span><span><i className="legend-request" /> Запити покупців</span><small>Число — кількість оголошень, що відповідають пошуку.</small></div>
            </aside>
        </div>
    </section>
}

const listingErrorMessages: Record<string, string> = {
    categoryId: 'Оберіть категорію', title: 'Назва має містити від 2 до 160 символів', description: 'Опис — до 5000 символів',
    quantity: 'Кількість має бути більшою за нуль', unit: 'Оберіть одиницю виміру', price: 'Вкажіть невід’ємну ціну',
    currency: 'Оберіть валюту', photos: 'Виберіть зображення PNG, JPG, WEBP або GIF до 5 МБ',
    minPrice: 'Перевірте мінімальну ціну', maxPrice: 'Перевірте максимальну ціну', priceRange: 'Максимальна ціна має бути не меншою за мінімальну',
    settlementCode: 'Оберіть населений пункт із підказок', geoZone: 'Оберіть населений пункт', geoArea: 'Оберіть населений пункт', address: 'Адреса — до 500 символів',
    latitude: 'Перевірте місце на мапі', longitude: 'Перевірте місце на мапі', deadline: 'Перевірте дату',
}
const listingErrors = (error: ApiError) => Object.fromEntries((error.fields ?? []).map((field) => [field, listingErrorMessages[field] || 'Перевірте це поле']))

function ProductEditor({ categories, product, onSaved, onCancel }: { categories: Category[]; product?: Product; onSaved: (location?: AddressValue) => void; onCancel: () => void }) {
    const [title, setTitle] = useState(product?.title ?? '')
    const [categoryId, setCategoryId] = useState(product?.category.id ?? '')
    const [photo, setPhoto] = useState(product?.photos[0]?.url ?? '')
    const [photoChanged, setPhotoChanged] = useState(false)
    const [location, setLocation] = useState<AddressValue>({ address: product?.address ?? '', city: product?.geoZone ?? '', coordinates: product?.coordinates ?? null, settlement: product?.settlement ?? null, addressVisibility: product?.addressVisibility ?? 'private', addressVisibilityConsent: product?.addressVisibility === 'public', mapLocationMode: product?.mapLocationMode })
    const [status, setStatus] = useState(product?.status ?? 'active')
    const [errors, setErrors] = useState<Record<string, string>>({})
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    const [locationBusy, setLocationBusy] = useState(false)
    const setImage = (next: string) => { setPhoto(next); setPhotoChanged(true); setErrors((current) => ({ ...current, photos: '' })) }
    const readFile = (file?: File) => {
        if (!file) return
        if (!['image/png', 'image/jpeg', 'image/webp', 'image/gif'].includes(file.type) || file.size > 5 * 1024 * 1024) { setErrors((current) => ({ ...current, photos: listingErrorMessages.photos })); return }
        const reader = new FileReader()
        reader.onload = () => setImage(String(reader.result))
        reader.onerror = () => setErrors((current) => ({ ...current, photos: 'Не вдалося прочитати файл' }))
        reader.readAsDataURL(file)
    }
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy || locationBusy) return
        setErrors({}); setError('')
        if (!categoryId) { setErrors({ categoryId: listingErrorMessages.categoryId }); return }
        if (!location.city.trim()) { setErrors({ location: 'Оберіть населений пункт.' }); return }
        if (photoChanged && photo && !/^(https?:\/\/|data:image\/)/i.test(photo)) { setErrors({ photos: 'Вкажіть URL https:// або завантажте зображення.' }); return }
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        const payload = {
            categoryId, title: title.trim(), description: data.description, quantity: Number(data.quantity), unit: data.unit,
            price: Number(data.price), currency: data.currency, deliveryMode: data.deliveryMode, geoZone: location.city.trim(),
            ...addressFields(location), status,
            ...((photoChanged || !product) ? { photos: photo ? [{ ...(photo.startsWith('data:') ? { dataUrl: photo } : { url: photo }), alt: title.trim() }] : [] } : {}),
        }
        setBusy(true)
        try { await request(product ? '/api/products/' + product.id : '/api/products', { method: product ? 'PATCH' : 'POST', body: JSON.stringify(payload) }); onSaved(location) }
        catch (caught) { setError((caught as Error).message); setErrors(listingErrors(caught as ApiError)) }
        finally { setBusy(false) }
    }
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">Пропозиція продавця</span><h1>{product ? 'Редагувати товар' : 'Додати товар'}</h1></div><button className="icon-button" type="button" onClick={onCancel} aria-label="Закрити форму">×</button></div>
        <form className="product-form listing-form" onSubmit={submit}>
            <ListingBasics categories={categories} categoryId={categoryId} onCategoryChange={setCategoryId} title={title} onTitleChange={setTitle} description={product?.description} errors={errors} />
            <fieldset className="listing-section"><legend>Фото товару</legend><div className="photo-drop">
                {photo && <img className="photo-preview" src={photo.startsWith('/') ? imageUrl(photo) : photo} alt="Попередній перегляд товару" />}
                <label>Завантажити фото<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" onChange={(event) => readFile(event.target.files?.[0])} /></label>
                <label>Або посилання на фото<input type="url" value={photo.startsWith('data:') || photo.startsWith('/') ? '' : photo} onChange={(event) => setImage(event.target.value)} placeholder="https://…" /></label>
                <small>PNG, JPG, WEBP або GIF · до 5 МБ</small>
                {photo && <button type="button" className="text-button" onClick={() => setImage('')}>Прибрати фото</button>}<FieldError message={errors.photos} />
            </div></fieldset>
            <fieldset className="listing-section"><legend>Кількість і ціна</legend><QuantityFields quantity={product?.quantity} unit={product?.unit ?? 'piece'} errors={errors} />
                <div className="field-row"><label>Ціна за одиницю<input name="price" type="number" min="0" step=".01" defaultValue={product?.price.amount ?? 0} required /><FieldError message={errors.price} /></label><CurrencyField currency={product?.price.currency} error={errors.currency} /></div>
            </fieldset>
            <ListingLocationFields value={location} onChange={setLocation} request={request} onBusyChange={setLocationBusy} error={errors.location || errors.settlementCode || errors.geoZone || errors.address || errors.latitude || errors.longitude} />
            <fieldset className="listing-section"><legend>Умови публікації</legend>
                <label>Доставка<select name="deliveryMode" defaultValue={product?.deliveryMode ?? 'pickup'}>{Object.entries(DELIVERY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><FieldError message={errors.deliveryMode} /></label>
                <label>Статус<select value={status} onChange={(event) => setStatus(event.target.value)}>{Object.entries(STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="listing-form-actions"><button type="button" className="outline-button" onClick={onCancel}>Скасувати</button><button className="primary-button" disabled={busy || locationBusy}>{busy ? 'Збереження…' : product ? 'Зберегти зміни' : status === 'active' ? 'Опублікувати товар' : 'Зберегти товар'}</button></div>
        </form>
    </section>
}
const ProductForm = ProductEditor

function BuyRequestForm({ categories, onSaved, onCancel }: { categories: Category[]; onSaved: (location?: AddressValue) => void; onCancel: () => void }) {
    const [title, setTitle] = useState('')
    const [categoryId, setCategoryId] = useState('')
    const [location, setLocation] = useState<AddressValue>(emptyAddress)
    const [busy, setBusy] = useState(false)
    const [locationBusy, setLocationBusy] = useState(false)
    const [error, setError] = useState('')
    const [errors, setErrors] = useState<Record<string, string>>({})
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        if (busy || locationBusy) return
        setError(''); setErrors({})
        if (!categoryId) { setErrors({ categoryId: listingErrorMessages.categoryId }); return }
        if (!location.city.trim()) { setErrors({ location: 'Оберіть населений пункт.' }); return }
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        if (Number(data.minPrice) > Number(data.maxPrice)) { setErrors({ priceRange: listingErrorMessages.priceRange }); return }
        const payload = {
            categoryId, title: title.trim(), description: data.description || '', quantity: Number(data.quantity), unit: data.unit,
            currency: data.currency, minPrice: Number(data.minPrice), maxPrice: Number(data.maxPrice),
            delivery: data.delivery, preferredDelivery: data.preferredDelivery || null, geoArea: location.city.trim(), ...addressFields(location),
            deadline: data.deadline ? new Date(data.deadline + 'T23:59:59').toISOString() : null,
        }
        setBusy(true)
        try { await request('/api/buy-requests', { method: 'POST', body: JSON.stringify(payload) }); onSaved(location) }
        catch (caught) { setError((caught as Error).message); setErrors(listingErrors(caught as ApiError)) }
        finally { setBusy(false) }
    }
    return <section className="form-view"><div className="view-header"><div><span className="eyebrow">Запит покупця</span><h1>Створити запит на купівлю</h1></div><button className="icon-button" type="button" onClick={onCancel} aria-label="Закрити форму">×</button></div>
        <form className="product-form request-form listing-form" onSubmit={submit}>
            <ListingBasics categories={categories} categoryId={categoryId} onCategoryChange={setCategoryId} title={title} onTitleChange={setTitle} errors={errors} />
            <fieldset className="listing-section"><legend>Кількість і бюджет</legend><QuantityFields errors={errors} />
                <div className="field-row"><label>Ціна від, за одиницю<input name="minPrice" type="number" min="0" step=".01" defaultValue="0" required /><FieldError message={errors.minPrice} /></label><label>Ціна до, за одиницю<input name="maxPrice" type="number" min="0" step=".01" defaultValue="0" required /><FieldError message={errors.maxPrice} /></label></div>
                <FieldError message={errors.priceRange} /><CurrencyField error={errors.currency} />
            </fieldset>
            <ListingLocationFields value={location} onChange={setLocation} request={request} onBusyChange={setLocationBusy} error={errors.location || errors.settlementCode || errors.geoArea || errors.address || errors.latitude || errors.longitude} />
            <fieldset className="listing-section"><legend>Умови запиту</legend>
                <label>Доставка<select name="delivery" defaultValue="preferred"><option value="no">Не потрібна</option><option value="yes">Потрібна</option><option value="preferred">Бажана</option></select><FieldError message={errors.delivery} /></label>
                <label>Бажаний спосіб доставки<select name="preferredDelivery" defaultValue=""><option value="">За домовленістю</option>{Object.entries(DELIVERY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
                <label>Потрібно до дати<input name="deadline" type="date" /><FieldError message={errors.deadline} /></label>
            </fieldset>
            {error && <p className="form-error" role="alert">{error}</p>}
            <div className="listing-form-actions"><button type="button" className="outline-button" onClick={onCancel}>Скасувати</button><button className="primary-button" disabled={busy || locationBusy}>{busy ? 'Збереження…' : 'Опублікувати запит'}</button></div>
        </form>
    </section>
}

function Sidebar({ user, profileAvatar, view, go, logout, unreadCount, onNotificationScope }: { user: User; profileAvatar: string | null; view: View; go: (view: View) => void; logout: () => void; unreadCount: number; onNotificationScope: (scope: 'selling' | 'buying') => void }) {
    const [sellingOpen, setSellingOpen] = useState(true)
    const [buyingOpen, setBuyingOpen] = useState(true)
    const item = (key: View, icon: string, text: string, notificationScope?: 'selling' | 'buying') => <button key={`${key}-${notificationScope ?? ''}`} className={view === key ? 'active' : ''} onClick={() => { if (notificationScope) onNotificationScope(notificationScope); go(key) }}><span>{icon}</span><span>{text}</span>{notificationScope && unreadCount > 0 && <b className="sidebar-notification-count" aria-label={`Непрочитані сповіщення: ${unreadCount}`}>{unreadCount}</b>}</button>
    return <aside className="sidebar">
        <button type="button" className="brand sidebar-logo" onClick={() => go('find')} aria-label="На сторінку пошуку"><img className="brand-logo" src="/brand/logo-full.png" alt="ДещоТреба" /></button>
        <button type="button" className="seller-badge" onClick={() => go('profile')}><div className="avatar">{profileAvatar ? <img src={profileAvatar} alt="Аватар профілю" /> : user.username[0].toUpperCase()}</div><div><strong>{user.username}</strong><small>Мій кабінет</small></div></button>
        <nav className="sidebar-primary">
            {item('home', '⌂', 'Головна сторінка')}
            {item('find', '⌕', 'Знайти')}
            {item('messages', '♧', 'Мої повідомлення')}
        </nav>
        <nav className="sidebar-groups" aria-label="Розділи кабінету">
            <section className="sidebar-group"><button type="button" className="sidebar-group-toggle" onClick={() => setSellingOpen(value => !value)} aria-expanded={sellingOpen}><span>Продаю</span><span aria-hidden="true">{sellingOpen ? '⌃' : '⌄'}</span></button>{sellingOpen && <div>{item('create', '＋', 'Додати оголошення')}{item('mine', '▣', 'Мої оголошення')}{item('market', '⇄', 'Відгуки на запити')}{item('orders', '▤', 'Мої угоди')}{item('notifications', '•', 'Сповіщення', 'selling')}</div>}</section>
            <section className="sidebar-group"><button type="button" className="sidebar-group-toggle" onClick={() => setBuyingOpen(value => !value)} aria-expanded={buyingOpen}><span>Запити на покупку</span><span aria-hidden="true">{buyingOpen ? '⌃' : '⌄'}</span></button>{buyingOpen && <div>{item('request', '＋', 'Подати запит')}{item('requests', '⇅', 'Мої запити')}{item('notifications', '•', 'Сповіщення', 'buying')}</div>}</section>
        </nav>
        <button className="sidebar-exit" onClick={logout}>↪ Вийти</button>
    </aside>
}

function PublicPage({ children, user, onAccount, onCreate }: { children: any; user: User | null; onAccount: () => void; onCreate: () => void }) { return <>{!user && <header className="market-header detail-market-header"><div className="market-header-inner"><a className="market-logo" href="/"><img className="market-logo-full" src="/brand/logo-full.png" alt="ДещоТреба" /></a><button className="market-account" onClick={onAccount}>♙ Увійти або зареєструватися</button><button className="market-add" onClick={onCreate}>＋ Додати пропозицію</button></div></header>}<main className="public-detail-page">{children}</main></> }

function CompactPersonCard({ profile, role }: { profile: PublicProfile | null; role: 'Продавець' | 'Покупець' }) { return <aside className="listing-person-card">{!profile ? <p>Завантажуємо дані {role.toLowerCase()}…</p> : <><div className="listing-person-heading"><div className="listing-person-avatar">{profile.avatarUrl ? <img src={imageUrl(profile.avatarUrl)} alt="" /> : avatarInitials(profile.nickname || profile.username)}</div><div><small>{role}</small><strong>{profile.nickname || profile.username}</strong><span>★ {profile.ratingSummary.average ?? '—'} · {profile.ratingSummary.count} відгуків</span></div></div><p>⌖ {profile.location || 'Місце не вказано'}</p><div className="listing-person-stats"><span><b>{profile.statistics.listingsCount}</b> оголошень</span><span><b>{profile.statistics.completedDealsCount}</b> угод</span></div><a className="outline-button compact" href={'/profiles/' + encodeURIComponent(profile.username)}>Переглянути профіль</a></>}</aside> }

function ProductPage({ id, user, onEdit, onAccount, onCreate }: { id: string; user: User | null; onEdit: (product: Product) => void; onAccount: () => void; onCreate: () => void }) {
    const [product, setProduct] = useState<Product | null>(null), [error, setError] = useState('')
    useEffect(() => { request('/api/products/' + encodeURIComponent(id)).then(result => setProduct(result.product)).catch(error => setError(error.message)) }, [id])
    const [seller, setSeller] = useState<PublicProfile | null>(null)
    useEffect(() => { if (product?.owner.username) request('/api/profiles/' + encodeURIComponent(product.owner.username)).then(result => setSeller(result.profile)).catch(() => setSeller(null)) }, [product?.owner.username])
    return <PublicPage user={user} onAccount={onAccount} onCreate={onCreate}>{error ? <p className="form-error">{error}</p> : !product ? <p>Завантажуємо товар…</p> : <div className="listing-page-layout"><article className="listing-detail-page"><ListingPicture product={product} className="detail-image" /><div className="detail-body"><span className={`status status-${product.status}`}>{STATUS[product.status]}</span><span className="eyebrow">{product.category.name}</span><h1>{product.title}</h1><strong className="detail-price">{formatPrice(product.price.amount, product.price.currency)} <small>/ {unitLabel(product.unit)}</small></strong><div className="detail-facts"><span>⌖ <b>{product.publicAddress || product.geoZone}</b><small>Місце</small></span><span>▧ <b>{product.quantity} {unitLabel(product.unit)}</b><small>В наявності</small></span><span>♧ <b>{DELIVERY_LABELS[product.deliveryMode] ?? product.deliveryMode}</b><small>Отримання</small></span></div><section className="listing-description"><h2>Опис товару</h2><p>{product.description || 'Продавець ще не додав опис.'}</p></section>{user?.id === product.owner.id && <button className="primary-button" onClick={() => onEdit(product)}>Редагувати товар</button>}</div></article><CompactPersonCard profile={seller} role="Продавець" /></div>}</PublicPage>
}

function BuyRequestPage({ id, user, mine, notify, onAccount, onCreate }: { id: string; user: User | null; mine: Product[]; notify: (message: string) => void; onAccount: () => void; onCreate: () => void }) {
    const [item, setItem] = useState<BuyRequest | null>(null), [error, setError] = useState(''), [offerOpen, setOfferOpen] = useState(false)
    const [buyer, setBuyer] = useState<PublicProfile | null>(null)
    const load = () => request('/api/buy-requests/' + encodeURIComponent(id)).then(result => setItem(result.buyRequest)).catch(error => setError(error.message))
    useEffect(() => { load() }, [id])
    useEffect(() => { if (item?.buyer?.username) request('/api/profiles/' + encodeURIComponent(item.buyer.username)).then(result => setBuyer(result.profile)).catch(() => setBuyer(null)) }, [item?.buyer?.username])
    return <PublicPage user={user} onAccount={onAccount} onCreate={onCreate}>{error ? <p className="form-error">{error}</p> : !item ? <p>Завантажуємо запит…</p> : <div className="listing-page-layout"><article className="listing-detail-page request-detail-page"><div className="detail-body"><span className="eyebrow">Запит покупця · {item.category.name}</span><h1>{item.title}</h1><span className={`status status-${item.status}`}>{REQUEST_STATUS[item.status] ?? item.status}</span><div className="detail-facts"><span>⌖ <b>{item.geoArea}</b><small>Приблизне місце</small></span><span>▧ <b>{item.quantity} {item.unit}</b><small>Потрібно</small></span><span>₴ <b>{item.price.min ?? '—'}–{item.price.max ?? '—'} {item.price.currency}</b><small>Бажана ціна</small></span></div><section className="listing-description"><h2>Що потрібно покупцеві</h2><p>{item.description || 'Покупець ще не додав опис.'}</p><p>{item.delivery.required ? 'Потрібна доставка' : 'Доставка не потрібна'}{item.delivery.preferred ? `: ${item.delivery.preferred}` : ''}</p></section>{user && item.buyer?.id !== user.id && (offerOpen ? <OfferForm buyRequest={item} products={mine} notify={notify} onDone={() => { setOfferOpen(false); load() }} /> : <button className="primary-button" onClick={() => setOfferOpen(true)}>Запропонувати товар</button>)}</div></article><CompactPersonCard profile={buyer} role="Покупець" /></div>}</PublicPage>
}

function PublicProfilePage({ username, user, onAccount, onCreate }: { username: string; user: User | null; onAccount: () => void; onCreate: () => void }) {
    const [profile, setProfile] = useState<PublicProfile | null>(null), [error, setError] = useState(''), [tab, setTab] = useState<'products' | 'requests' | 'reviews'>('products')
    const [products, setProducts] = useState<Product[]>([]), [buyRequests, setBuyRequests] = useState<BuyRequest[]>([]), [reviews, setReviews] = useState<{ id: string; rating: number; body: string; createdAt: string; reviewerUsername: string }[]>([])
    useEffect(() => {
        let active = true
        setError(''); setProfile(null)
        Promise.all([request('/api/profiles/' + encodeURIComponent(username)), request('/api/products?limit=50&ownerUsername=' + encodeURIComponent(username)), request('/api/buy-requests?buyerUsername=' + encodeURIComponent(username)), request('/api/profiles/' + encodeURIComponent(username) + '/reviews')])
            .then(([profileResult, productsResult, requestsResult, reviewsResult]) => { if (active) { setProfile(profileResult.profile); setProducts(productsResult.products); setBuyRequests(requestsResult.buyRequests); setReviews(reviewsResult.reviews) } })
            .catch(error => { if (active) setError(error.message) })
        return () => { active = false }
    }, [username])
    const date = (value: string) => new Date(value).toLocaleDateString('uk-UA', { year: 'numeric', month: 'long' })
    const seen = profile?.lastSeenAt ? new Date(profile.lastSeenAt).toLocaleString('uk-UA', { dateStyle: 'medium', timeStyle: 'short' }) : 'ще не заходив'
    return <PublicPage user={user} onAccount={onAccount} onCreate={onCreate}>{error ? <p className="form-error">{error}</p> : !profile ? <p>Завантажуємо профіль…</p> : <section className="profile-public-page"><header className="public-profile-header"><div className="public-profile-avatar">{profile.avatarUrl ? <img src={imageUrl(profile.avatarUrl)} alt={'Аватар ' + (profile.nickname || profile.username)} /> : <b>{avatarInitials(profile.nickname || profile.username)}</b>}</div><div className="public-profile-title"><span className="eyebrow">Профіль користувача</span><h1>{profile.nickname || profile.username}</h1><p>@{profile.username} · ⌖ {profile.location || 'Місце не вказано'}</p><small>На сайті з {date(profile.createdAt)} · Був онлайн: {seen}</small></div>{profile.phone && <a className="primary-button profile-call" href={'tel:' + profile.phone}>Зателефонувати</a>}</header><div className="public-profile-stats"><div><b>{profile.ratingSummary.average ?? '—'}</b><span>★ Рейтинг {profile.ratingSummary.count ? `(${profile.ratingSummary.count})` : ''}</span></div><div><b>{profile.statistics.listingsCount}</b><span>Оголошень</span></div><div><b>{profile.statistics.completedDealsCount}</b><span>Завершених угод</span></div><div><b>{profile.statistics.responseRate ?? '—'}{profile.statistics.responseRate !== null ? '%' : ''}</b><span>Відповідей</span></div></div><section className="public-profile-bio"><h2>Про себе</h2><p>{profile.bio || 'Користувач ще не додав опис.'}</p></section><div className="public-profile-tabs" role="tablist" aria-label="Вміст профілю"><button role="tab" aria-selected={tab === 'products'} className={tab === 'products' ? 'active' : ''} onClick={() => setTab('products')}>Усі товари <small>{products.length}</small></button><button role="tab" aria-selected={tab === 'requests'} className={tab === 'requests' ? 'active' : ''} onClick={() => setTab('requests')}>Запити на покупку <small>{buyRequests.length}</small></button><button role="tab" aria-selected={tab === 'reviews'} className={tab === 'reviews' ? 'active' : ''} onClick={() => setTab('reviews')}>Відгуки <small>{reviews.length}</small></button></div><div className="public-profile-content">{tab === 'products' && (products.length ? <div className="product-grid">{products.map(product => <Card key={product.id} product={product} onOpen={() => window.location.assign('/products/' + encodeURIComponent(product.id))} />)}</div> : <Empty text="Активних товарів поки немає" />)}{tab === 'requests' && (buyRequests.length ? <div className="profile-request-list">{buyRequests.map(item => <a key={item.id} className="profile-request-row" href={'/buy-requests/' + encodeURIComponent(item.id)}><span><small>{item.category.name} · {item.geoArea}</small><strong>{item.title}</strong></span><span>{item.quantity} {item.unit}<small>{item.price.min ?? '—'}–{item.price.max ?? '—'} {item.price.currency}</small></span></a>)}</div> : <Empty text="Активних запитів поки немає" />)}{tab === 'reviews' && (reviews.length ? <div className="profile-review-list">{reviews.map(review => <article key={review.id} className="profile-review"><div><b>{'★'.repeat(review.rating)}{'☆'.repeat(5 - review.rating)}</b><small>{review.reviewerUsername} · {date(review.createdAt)}</small></div><p>{review.body || 'Без коментаря'}</p></article>)}</div> : <Empty text="Відгуків поки немає" />)}</div></section>}</PublicPage>
}

function App() {
    const [user, setUser] = useState<User | null>(null)
    const [authOpen, setAuthOpen] = useState(false)
    const [authReady, setAuthReady] = useState(false)
    const [pendingCreate, setPendingCreate] = useState(false)
    const [view, setView] = useState<View>('home')
    const [products, setProducts] = useState<Product[]>([]) // This line is unchanged
    const [mine, setMine] = useState<Product[]>([])
    const [categories, setCategories] = useState<Category[]>([])
    const [editing, setEditing] = useState<Product>()
    const [mapFocus, setMapFocus] = useState<HomeCity>()
    const [search, setSearch] = useState('')
    const [page, setPage] = useState(1)
    const [pages, setPages] = useState(1)
    const [toast, setToast] = useState('')
    const [loading, setLoading] = useState(false)
    const [profileAvatar, setProfileAvatar] = useState<string | null>(null)
    const [unreadNotifications, setUnreadNotifications] = useState(0)
    const [notificationScope, setNotificationScope] = useState<'selling' | 'buying'>('selling')
    const [path, setPath] = useState(() => window.location.pathname)
    useEffect(() => { const sync = () => setPath(window.location.pathname); window.addEventListener('popstate', sync); return () => window.removeEventListener('popstate', sync) }, [])
    const navigate = (next: string) => { window.history.pushState({}, '', next); setPath(next); window.scrollTo(0, 0) }
    const openProductPage = (product: Product) => navigate('/products/' + encodeURIComponent(product.id))
    const openRequestPage = (id: string) => navigate('/buy-requests/' + encodeURIComponent(id))
    const openProfilePage = (username: string) => navigate('/profiles/' + encodeURIComponent(username))
    const notify = (message: string) => { if (message === 'Нових повідомлень немає') { setView('notifications'); return }; setToast(message); window.setTimeout(() => setToast(''), 3000) }
    const loadProducts = async (nextPage = 1) => { setLoading(true); try { const params = new URLSearchParams({ page: String(nextPage), limit: '8' }); if (search) params.set('geoZone', search); const result = await request(`/api/products?${params}`); setProducts(result.products); setPage(result.pagination.page); setPages(result.pagination.pages) } catch (error) { notify((error as Error).message) } finally { setLoading(false) } }
    const loadMine = async () => { try { setMine((await request('/api/products/mine?limit=50')).products) } catch (error) { notify((error as Error).message) } }
    const go = (next: View) => { setView(next); setEditing(undefined); if (path !== '/') navigate('/') }
    const logout = async () => { await request('/api/auth/logout', { method: 'POST' }); setUser(null); setView('home'); setAuthOpen(false); setPendingCreate(false); setMine([]); setProfileAvatar(null) }
    const rememberLocation = (location?: AddressValue) => { if (validCoordinates(location?.coordinates)) setMapFocus({ name: location!.city, ...location!.coordinates!, settlement: location!.settlement }) }
    const saved = (location?: AddressValue) => { rememberLocation(location); setView('mine'); setEditing(undefined); loadProducts(page); loadMine(); notify('Товар збережено') }
    const requestSaved = (location?: AddressValue) => { rememberLocation(location); setView('map'); notify('Запит опубліковано на мапі') }
    const removeProduct = async (product: Product) => { if (!window.confirm(`Видалити товар «${product.title}»?`)) return; try { await request(`/api/products/${product.id}`, { method: 'DELETE' }); await loadProducts(page); await loadMine(); notify('Товар видалено') } catch (error) { notify((error as Error).message) } }
    useEffect(() => { request('/api/auth/me').then((result) => setUser(result.user)).catch(() => undefined).finally(() => setAuthReady(true)); request('/api/categories').then((result) => setCategories(result.categories)).catch(() => undefined) }, [])
    useEffect(() => { if (user) { loadProducts(); loadMine(); request('/api/profile/me').then((result) => setProfileAvatar(result.profile.avatarUrl ?? null)).catch(() => undefined); request('/api/notifications').then((result) => setUnreadNotifications(result.notifications.filter((item: Notification) => !item.readAt).length)).catch(() => undefined) } else setUnreadNotifications(0) }, [user])
    if (window.location.pathname === '/verify-email') return <VerifyEmail />
    const enter = (create = false) => { setPendingCreate(create); setAuthOpen(true) }
    const loggedIn = (nextUser: User) => { setUser(nextUser); setAuthOpen(false); setView(pendingCreate ? 'create' : 'home'); setPendingCreate(false) }
    if (new URLSearchParams(window.location.search).has('reset-password') || (!user && authOpen)) return <><button className="auth-home-back" onClick={() => { window.history.replaceState({}, '', window.location.pathname); setAuthOpen(false); setPendingCreate(false) }}>← На головну</button><Auth initialRegister={!new URLSearchParams(window.location.search).has('reset-password')} onLogin={loggedIn} /></>
    const productRoute = path.match(/^\/products\/([^/]+)$/)
    const buyRequestRoute = path.match(/^\/buy-requests\/([^/]+)$/)
    const profileRoute = path.match(/^\/profiles\/([^/]+)$/)
    const detailShell = (content: any) => !user ? content : <div className="app-shell"><Sidebar user={user} profileAvatar={profileAvatar} view={view} go={go} logout={logout} unreadCount={unreadNotifications} onNotificationScope={setNotificationScope} /><main className="main-area"><header className="topbar"><button className="mobile-brand" onClick={() => go('find')}><img className="brand-mini" src="/brand/logo-mini.png" alt="" /><span>ДещоТреба</span></button></header>{content}</main></div>
    if (productRoute) return detailShell(<ProductPage id={decodeURIComponent(productRoute[1])} user={user} onAccount={() => enter()} onCreate={() => enter(true)} onEdit={(product) => { setEditing(product); setView('create'); navigate('/') }} />)
    if (buyRequestRoute) return detailShell(<BuyRequestPage id={decodeURIComponent(buyRequestRoute[1])} user={user} mine={mine} notify={notify} onAccount={() => enter()} onCreate={() => enter(true)} />)
    if (profileRoute) return detailShell(<PublicProfilePage username={decodeURIComponent(profileRoute[1])} user={user} onAccount={() => enter()} onCreate={() => enter(true)} />)
    if (!user) return <><PublicHome locationReady={authReady} categories={categories} request={request} user={null} onAccount={() => enter()} onCreate={() => enter(true)} openProduct={openProductPage} renderMap={(mapProps) => <MapView {...mapProps} categories={categories} openProduct={openProductPage} openRequest={openRequestPage} openProfile={openProfilePage} notify={notify} />} />{toast && <div className="toast">{toast}</div>}</>
    return <div className="app-shell"><Sidebar user={user} profileAvatar={profileAvatar} view={view} go={go} logout={logout} unreadCount={unreadNotifications} onNotificationScope={setNotificationScope} /><main className="main-area"><header className="topbar"><button className="mobile-brand" onClick={() => go('find')}><img className="brand-mini" src="/brand/logo-mini.png" alt="" /><span>ДещоТреба</span></button></header>{view === 'home' && <Home user={user} products={products} open={openProductPage} explore={() => go('find')} create={() => go('create')} />}{view === 'find' && <PublicHome locationReady={authReady} categories={categories} request={request} user={user} onAccount={() => go('profile')} onCreate={() => go('create')} openProduct={openProductPage} renderMap={(mapProps) => <MapView {...mapProps} categories={categories} openProduct={openProductPage} openRequest={openRequestPage} openProfile={openProfilePage} notify={notify} />} />}{view === 'products' && <Catalog categories={categories} products={products} loading={loading} search={search} setSearch={setSearch} searchNow={() => loadProducts(1)} page={page} pages={pages} onPage={loadProducts} open={openProductPage} />}{view === 'map' && <MapView userId={user.id} city={mapFocus} categories={categories} openProduct={openProductPage} openRequest={openRequestPage} openProfile={openProfilePage} notify={notify} />}{view === 'messages' && <MessagesView notify={notify} />}{view === 'notifications' && <NotificationsView notify={notify} scope={notificationScope} onRead={() => setUnreadNotifications(0)} />}{view === 'request' && <BuyRequestForm categories={categories} onSaved={requestSaved} onCancel={() => go('home')} />}{view === 'mine' && <Mine products={mine} open={openProductPage} create={() => go('create')} edit={(product) => { setEditing(product); setView('create') }} setStatus={async (product, status) => { try { await request(`/api/products/${product.id}`, { method: 'PATCH', body: JSON.stringify({ status }) }); await loadMine(); notify('Статус оновлено') } catch (error) { notify((error as Error).message) } }} />}{view === 'create' && <ProductForm categories={categories} product={editing} onSaved={saved} onCancel={() => go(editing ? 'mine' : 'home')} />}{view === 'requests' && <MyRequests notify={notify} create={() => go('request')} />}{view === 'market' && <RequestsMarket mine={mine} notify={notify} />}{view === 'orders' && <OrdersView notify={notify} />}{view === 'profile' && <ProfileView logout={logout} notify={notify} />}</main><nav className="mobile-nav">{[['home', '⌂', 'Головна'], ['find', '⌕', 'Знайти'], ['messages', '♧', 'Чати'], ['request', '↗', 'Запит'], ['profile', '♙', 'Профіль']].map(([key, icon, text]) => <button key={key} className={view === key ? 'active' : ''} onClick={() => go(key as View)}><span>{icon}</span>{text}</button>)}</nav>{toast && <div className="toast">{toast}</div>}</div>
}

function Home({ user, products, open, explore, create }: { user: User; products: Product[]; open: (product: Product) => void; explore: () => void; create: () => void }) { return <section className="content"><div className="welcome"><div><span className="eyebrow">Понеділок, гарного дня</span><h1>Привіт, {user.username} <span>✦</span></h1><p>Що шукаєте або продаєте сьогодні?</p></div><button className="primary-button compact" onClick={create}>＋ Додати товар</button></div><div className="hero-strip"><div><span className="eyebrow">Локальний маркетплейс</span><h2>Ваш врожай<br /><em>має значення.</em></h2><button className="light-button" onClick={explore}>Переглянути товари <span>→</span></button></div><div className="hero-art">✦</div></div><div className="section-heading"><div><span className="eyebrow">Рекомендоване</span><h2>Товари поруч</h2></div><button className="text-button" onClick={explore}>Дивитись всі →</button></div><div className="product-grid">{products.slice(0, 4).map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} />)}</div>{!products.length && <Empty text="Поки немає активних товарів" />}</section> }
function Catalog({ categories, products, loading, search, setSearch, searchNow, page, pages, onPage, open }: { categories: Category[]; products: Product[]; loading: boolean; search: string; setSearch: (value: string) => void; searchNow: () => void; page: number; pages: number; onPage: (page: number) => void; open: (product: Product) => void }) { const [selectedCategory, setSelectedCategory] = useState(''); const [catalogQuery, setCatalogQuery] = useState(''); const [catalogSettlement, setCatalogSettlement] = useState<Settlement | null>(null); const [catalogProducts, setCatalogProducts] = useState(products); const [catalogPage, setCatalogPage] = useState(page); const [catalogPages, setCatalogPages] = useState(pages); const [catalogLoading, setCatalogLoading] = useState(false); const runSearch = async (nextPage = 1, category = selectedCategory) => { setCatalogLoading(true); try { const params = new URLSearchParams({ page: String(nextPage), limit: '8' }); if (search) params.set('geoZone', search); if (catalogSettlement) params.set('settlementCode', catalogSettlement.code); if (catalogQuery.trim()) params.set('q', catalogQuery.trim()); if (category) params.set('categoryId', category); const result = await request(`/api/products?${params}`); setCatalogProducts(result.products); setCatalogPage(result.pagination.page); setCatalogPages(result.pagination.pages) } finally { setCatalogLoading(false) } }; useEffect(() => { if (!selectedCategory && !search && !catalogQuery) { setCatalogProducts(products); setCatalogPage(page); setCatalogPages(pages) } }, [products, page, pages, selectedCategory, search, catalogQuery]); const chooseCategory = (value: string) => { setSelectedCategory(value); runSearch(1, value) }; const busy = loading || catalogLoading; return <section className="content"><div className="view-header"><div><span className="eyebrow">Каталог</span><h1>Знайти товари</h1></div></div><div className="search-bar"><span>⌕</span><input type="search" aria-label="Пошук товару або продавця" value={catalogQuery} onChange={(event) => setCatalogQuery(event.target.value)} onKeyDown={(event) => event.key === 'Enter' && runSearch(1)} placeholder="Товар або логін продавця" /><SettlementPicker value={catalogSettlement} legacyName={search} onChange={item => { setCatalogSettlement(item); setSearch(item?.name ?? '') }} allowClear /><button onClick={() => runSearch(1)}>Пошук</button></div><div className="filter-row"><span className="result-label">Активні товари</span><CategoryPicker categories={categories} value={selectedCategory} onChange={chooseCategory} allowAll /></div>{busy ? <div className="loading">Завантаження каталогу...</div> : catalogProducts.length ? <><div className="product-grid">{catalogProducts.map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} />)}</div><Pagination page={catalogPage} pages={catalogPages} onPage={(nextPage) => { runSearch(nextPage); onPage(nextPage) }} /></> : <Empty text="Нічого не знайдено" />}</section> }
function Mine({ products, open, create, edit, remove, setStatus }: { products: Product[]; open: (product: Product) => void; create: () => void; edit: (product: Product) => void; remove?: (product: Product) => void; setStatus?: (product: Product, status: string) => void }) { const removeFromMine = remove ?? (async (product: Product) => { if (!window.confirm(`Видалити товар «${product.title}»?`)) return; await request(`/api/products/${product.id}`, { method: 'DELETE' }); window.location.reload() }); return <section className="content"><div className="view-header"><div><span className="eyebrow">Мій кабінет</span><h1>Мої товари</h1></div><button className="primary-button compact" onClick={create}>＋ Додати товар</button></div><div className="mine-summary"><strong>{products.length}</strong><span>всього товарів</span><strong>{products.filter((item) => item.status === 'active').length}</strong><span>активних</span></div>{products.length ? <div className="product-grid">{products.map((product) => <Card key={product.id} product={product} onOpen={() => open(product)} onEdit={() => edit(product)} onDelete={() => removeFromMine(product)} onStatus={setStatus ? (status) => setStatus(product, status) : undefined} />)}</div> : <Empty text="У вас ще немає товарів" action="Створити перший товар" onAction={create} />}</section> }
type Offer = { id: string; seller: { id: string; username: string }; buyRequestId: string; existingProduct: { id: string; title: string } | null; quantity: number; acceptedQuantity: number; unit: string; price: { amount: number; currency: string }; delivery: string; note: string; status: string; createdAt: string }
type Order = { id: string; buyRequestId: string; buyer: { id: string; username: string }; seller: { id: string; username: string }; quantity: number | null; unit: string; price: { unit: number | null; currency: string }; subtotal: number; status: string; conditionsSnapshot: { productTitle?: string } | null; cancelReason?: string | null; dispute?: { status: string; reason: string; resolution: string | null } | null }
type ChatMessage = { id: string; senderId: string; senderUsername: string; body: string; createdAt: string }
type Conversation = { id: string; orderId: string; status: string; otherUsername: string; userRole?: 'selling' | 'buying'; lastMessage: string | null; lastMessageAt: string | null; lastReadAt: string | null }
type Notification = { id: string; type: string; title: string; body: string; userRole?: 'selling' | 'buying' | 'general'; orderId: string | null; conversationId: string | null; readAt: string | null; createdAt: string }
type PublicProfile = { id: string; username: string; nickname: string | null; avatarUrl: string | null; bio: string | null; countryCode: string; location: string | null; phone: string | null; statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }; ratingSummary: { average: number | null; count: number }; createdAt: string; lastSeenAt: string | null }
type PrivateProfile = { mapLocation?: ProfileMapLocation; id: string; username: string; nickname: string | null; avatarUrl: string | null; bio: string | null; countryCode: string; location: string | null; phone: string; email: string | null; emailVerified: boolean; recoveryEmail: string | null; exactAddress: string | null; privacy: { phoneVisibility: 'private' | 'authenticated' | 'public'; phoneDisclosureConsent: boolean }; statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }; ratingSummary: { average: number | null; count: number } }
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
        <div className="request-list">{requests.map((item) => <article key={item.id} className="request-card"><header><div><span className="eyebrow">{item.category.name} · {item.geoArea}</span><h3><a href={'/buy-requests/' + encodeURIComponent(item.id)}>{item.title}</a></h3></div><span className={`status status-${item.status}`}>{REQUEST_STATUS[item.status] ?? item.status}</span></header>
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
        <div className="request-list">{requests.map((item) => <article key={item.id} className="request-card"><header><div><span className="eyebrow">{item.category.name} · {item.geoArea}</span><h3><a href={'/buy-requests/' + encodeURIComponent(item.id)}>{item.title}</a></h3></div><span className="status status-active">{REQUEST_STATUS[item.status] ?? item.status}</span></header>
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
    const [scope, setScope] = useState<'all' | 'selling' | 'buying'>('all')
    const load = async () => { try { setConversations((await request('/api/conversations')).conversations) } catch (error) { notify((error as Error).message) } }
    useEffect(() => { load() }, [])
    const visible = scope === 'all' ? conversations : conversations.filter((conversation) => conversation.userRole === scope)
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Спілкування</span><h1>Мої повідомлення</h1><p className="view-subtitle">Чати прив’язані до реальних замовлень.</p></div><button className="outline-button" onClick={load}>↻ Оновити</button></div><div className="message-scope-tabs" role="tablist" aria-label="Тип чатів"><button className={scope === 'all' ? 'active' : ''} onClick={() => setScope('all')}>Усі чати</button><button className={scope === 'selling' ? 'active' : ''} onClick={() => setScope('selling')}>Продажі</button><button className={scope === 'buying' ? 'active' : ''} onClick={() => setScope('buying')}>Покупки</button></div><div className="conversation-list">{visible.map((conversation) => <button className="conversation-row" key={conversation.id} onClick={() => setChat({ conversationId: conversation.id, title: `Замовлення з ${conversation.otherUsername}` })}><span><strong>{conversation.otherUsername}</strong><small>{conversation.lastMessage ?? 'Повідомлень ще немає'}</small></span><small>{conversation.lastMessageAt ? new Date(conversation.lastMessageAt).toLocaleString('uk-UA') : ''}</small></button>)}{!visible.length && <Empty text={scope === 'all' ? 'Повідомлень поки немає' : 'У цій категорії чатів поки немає'} />}</div>{chat && <ChatPanel chat={chat} onClose={() => setChat(null)} notify={notify} />}</section>
}

function NotificationsView({ notify, onRead, scope }: { notify: (message: string) => void; onRead: () => void; scope: 'selling' | 'buying' }) {
    const [notifications, setNotifications] = useState<Notification[]>([])
    const [showRead, setShowRead] = useState(true)
    const load = async () => { try { setNotifications((await request('/api/notifications')).notifications) } catch (error) { notify((error as Error).message) } }
    useEffect(() => { load() }, [])
    const markAllRead = async () => { try { await request('/api/notifications/read', { method: 'PATCH', body: '{}' }); onRead(); await load() } catch (error) { notify((error as Error).message) } }
    const visible = notifications.filter((item) => (item.userRole === scope || item.userRole === 'general') && (showRead || !item.readAt))
    return <section className="content"><div className="view-header"><div><span className="eyebrow">Центр подій</span><h1>Сповіщення: {scope === 'selling' ? 'продажі' : 'покупки'}</h1></div><button className="outline-button" onClick={markAllRead}>Позначити прочитаними</button></div><label className="notification-display-setting"><input type="checkbox" checked={showRead} onChange={(event) => setShowRead(event.target.checked)} /> Показувати прочитані сповіщення</label><div className="notification-list">{visible.map((item) => <article className={`notification-row ${item.readAt ? '' : 'unread'}`} key={item.id}><strong>{item.title}</strong><p>{item.body}</p><small>{new Date(item.createdAt).toLocaleString('uk-UA')}</small></article>)}{!visible.length && <Empty text="Нових сповіщень немає" />}</div></section>
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
    const [locationBusy, setLocationBusy] = useState(false)
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
    const loadAvatar = (file: File) => new Promise<string>((resolve, reject) => { const reader = new FileReader(); reader.onload = () => { const image = new Image(); image.onload = () => { const size = 512; const canvas = document.createElement('canvas'); canvas.width = size; canvas.height = size; const scale = Math.max(size / image.width, size / image.height); canvas.getContext('2d')?.drawImage(image, (size - image.width * scale) / 2, (size - image.height * scale) / 2, image.width * scale, image.height * scale); resolve(canvas.toDataURL('image/jpeg', .82)) }; image.onerror = reject; image.src = String(reader.result) }; reader.onerror = reject; reader.readAsDataURL(file) })
    const saveAvatar = async () => { if (!profile) return; setBusy(true); try { const result = await request('/api/profile/me', { method: 'PATCH', body: JSON.stringify({ avatarUrl: profile.avatarUrl }) }); setProfile(result.profile); setEditingAvatar(false); notify('Аватар збережено') } catch (error) { setMessage((error as Error).message) } finally { setBusy(false) } }
    useEffect(() => {
        request('/api/profile/me').then((result) => { setProfile(result.profile); setEmailDraft(result.profile.email ?? ''); setVisibility(result.profile.privacy.phoneVisibility); setConsent(result.profile.privacy.phoneDisclosureConsent) }).catch((error) => notify((error as Error).message))
    }, [])
    if (!profile) return <section className="content"><Empty text="Завантаження профілю…" /></section>
    const save = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); setMessage('')
        if (locationBusy || busy) return
        if (profile.mapLocation?.mode !== 'approximate' && profile.mapLocation && (!validCoordinates(profile.mapLocation) || !profile.mapLocation.consent)) { setMessage('Оберіть публічну точку та підтвердіть згоду на її показ.'); return }
        setBusy(true)
        const data = Object.fromEntries(new FormData(event.currentTarget).entries()) as Record<string, string>
        try { const result = await request('/api/profile/me', { method: 'PATCH', body: JSON.stringify({ ...(data.email !== (profile.email ?? '') ? { email: data.email } : {}), nickname: data.nickname, bio: data.bio, avatarUrl: profile.avatarUrl, location: profile.location, exactAddress: profile.exactAddress, settlementCode: profile.settlement?.code ?? null, addressSettlementCode: profile.addressSettlement?.code ?? null, addressCoordinates: profile.addressCoordinates ?? null, mapLocation: profile.mapLocation, phone: data.phone }) }); const privacy = await request('/api/profile/me/privacy', { method: 'PATCH', body: JSON.stringify({ phoneVisibility: visibility, phoneDisclosureConsent: consent }) }); setProfile(privacy.profile ?? result.profile); if (privacy.profile) setVisibility(privacy.profile.privacy.phoneVisibility); notify('Профіль збережено') }
        catch (caught) { setMessage((caught as Error).message) } finally { setBusy(false) }
    }
    const savePrivacy = async () => {
        setMessage('')
        try { const result = await request('/api/profile/me/privacy', { method: 'PATCH', body: JSON.stringify({ phoneVisibility: visibility, phoneDisclosureConsent: consent }) }); setProfile(result.profile); notify('Налаштування приватності збережено') }
        catch (caught) { setMessage((caught as Error).message) }
    }
    const openEditor = (editor: 'avatar' | 'phone' | 'email' | 'password') => { setEditingAvatar(editor === 'avatar'); setEditingPhone(editor === 'phone'); setEditingEmail(editor === 'email'); setEditingPassword(editor === 'password'); setPhoneCodeSent(false); setEmailCodeSent(false); setPasswordMessage(''); if (editor === 'email') setEmailDraft(profile.email ?? '') }
    return <section className="content profile-view"><span className="eyebrow">Налаштування</span><h1>Налаштування профілю</h1>
        <div className="profile-hero"><div className="profile-rating"><span aria-label="Рейтинг">{[0,1,2,3,4].map((star) => <span key={star} className={profile.ratingSummary.average !== null && star < Math.round(profile.ratingSummary.average) ? 'star-filled' : 'star-empty'}>★</span>)}</span><b>{profile.ratingSummary.average ?? '—'}</b></div><div className="profile-avatar-wrap"><div className="profile-avatar">{profile.avatarUrl ? <img src={profile.avatarUrl} alt="Аватар профілю" /> : <span>{(profile.nickname || profile.username)[0]?.toUpperCase()}</span>}</div><button type="button" className="avatar-edit" aria-label="Редагувати фото та нікнейм" onClick={() => openEditor('avatar')}>✎</button></div><strong>{profile.nickname || profile.username}</strong><small>@{profile.username}</small><div className="profile-hero-stats"><span><b>{profile.statistics.listingsCount}</b> активних товарів</span><span><b>{profile.statistics.completedDealsCount}</b> завершених угод</span><span><b>{profile.statistics.responseRate ?? '—'}%</b> відповідей</span></div>{editingAvatar && <div className="avatar-editor editor-popup"><button type="button" className="modal-close" onClick={() => setEditingAvatar(false)}>×</button><input type="file" accept="image/*" onChange={async (event) => { const file = event.target.files?.[0]; if (!file) return; try { const avatarUrl = await loadAvatar(file); setProfile({ ...profile, avatarUrl }) } catch { setMessage('Не вдалося прочитати зображення') } }} /><input placeholder="Або URL зображення" value={profile.avatarUrl ?? ''} onChange={(event) => setProfile({ ...profile, avatarUrl: event.target.value })} /><div className="avatar-editor-actions"><button type="button" className="primary-button compact" disabled={busy} onClick={saveAvatar}>Зберегти</button><button type="button" className="outline-button compact" onClick={() => { setEditingAvatar(false); request('/api/profile/me').then((result) => setProfile(result.profile)) }}>Скасувати</button></div></div>}</div>
        <div className="profile-stats"><span><b>{profile.statistics.listingsCount}</b><small>товарів</small></span><span><b>{profile.statistics.completedDealsCount}</b><small>угод</small></span><span><b>{profile.ratingSummary.average ?? '—'}</b><small>рейтинг ({profile.ratingSummary.count})</small></span></div>
        <form className="product-form" onSubmit={save}>
            <label>Логін<input value={profile.username} readOnly /></label>
            <label className={`phone-field ${profile.phoneVerified ? 'phone-verified' : 'phone-unverified'} ${editingPhone ? 'editor-popup' : ''}`}>Телефон <span className="phone-status">({profile.phoneVerified ? 'підтверджений' : 'не підтверджений'})</span><div className="phone-display"><input value={profile.phone} readOnly /><button type="button" className="avatar-edit inline-edit" onClick={() => openEditor('phone')}>✎</button></div>{editingPhone && <div className="phone-editor"><button type="button" className="modal-close" onClick={() => setEditingPhone(false)}>×</button><PhoneInput countryCode={phoneCountry} phone={profile.phone} onCountryCode={setPhoneCountry} onPhone={(value) => setProfile({ ...profile, phone: value })} /><button type="button" className="outline-button compact" onClick={async () => { try { setPhoneCodeError(''); setPhoneCodeSent(true); await request('/api/profile/me/phone-verification', { method: 'POST', body: JSON.stringify({ countryCode: phoneCountry, phone: profile.phone }) }); notify('Код підтвердження виведено в термінал бекенду') } catch (error) { setPhoneCodeSent(false); setMessage((error as Error).message) } }}>Підтвердити телефон</button></div>}{phoneCodeSent && <div className="verification-popup-inline"><input value={phoneCode} onChange={(event) => setPhoneCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-значний код" /><button type="button" className="outline-button compact" disabled={phoneCode.length !== 6} onClick={async () => { try { await request('/api/profile/me/phone-verification/confirm', { method: 'POST', body: JSON.stringify({ code: phoneCode }) }); setPhoneCodeSent(false); setPhoneCode(''); setEditingPhone(false); notify('Телефон підтверджено') } catch (error) { setPhoneCodeError((error as Error).message) } }}>Підтвердити</button><ResendCodeButton onResend={() => request('/api/profile/me/phone-verification', { method: 'POST', body: JSON.stringify({ countryCode: phoneCountry, phone: profile.phone }) })} />{phoneCodeError && <span className="field-error">{phoneCodeError}</span>}</div>}</label>
            <label className={`email-field ${profile.emailVerified ? 'email-verified' : 'email-unverified'} ${editingEmail ? 'editor-popup' : ''}`}>Електронна пошта <span className="email-status">({profile.emailVerified ? 'підтверджена' : 'не підтверджена'})</span><div className="phone-display"><input name="email" type="email" value={editingEmail ? emailDraft : (profile.email ?? '')} maxLength={254} readOnly={!editingEmail} autoFocus={editingEmail} onChange={(event) => setEmailDraft(event.target.value)} />{!editingEmail && <button type="button" className="avatar-edit inline-edit" onClick={() => openEditor('email')}>✎</button>}</div>{editingEmail && <button type="button" className="modal-close" onClick={() => setEditingEmail(false)}>×</button>}{editingEmail && emailDraft.trim().toLowerCase() !== (profile.email ?? '').toLowerCase() && <button type="button" className="outline-button compact" onClick={async () => { try { await request('/api/profile/me', { method: 'PATCH', body: JSON.stringify({ email: emailDraft }) }); await request('/api/profile/me/email-verification', { method: 'POST', body: JSON.stringify({ email: emailDraft }) }); setEmailCodeSent(true); notify('Код підтвердження виведено в термінал бекенду') } catch (error) { setMessage((error as Error).message) } }}>{emailCodeSent ? 'Надіслати повторно' : 'Підтвердити email'}</button>}{emailCodeSent && <div className="verification-popup-inline"><input value={emailCode} onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" placeholder="6-значний код" /><button type="button" className="outline-button compact" disabled={emailCode.length !== 6} onClick={async () => { try { await request('/api/profile/me/email-verification/confirm', { method: 'POST', body: JSON.stringify({ code: emailCode }) }); setEmailCodeSent(false); setEmailCode(''); setEditingEmail(false); const result = await request('/api/profile/me'); setProfile(result.profile); setEmailDraft(result.profile.email ?? ''); notify('Email підтверджено') } catch (error) { setMessage((error as Error).message) } }}>Підтвердити код</button><ResendCodeButton onResend={() => request('/api/profile/me/email-verification', { method: 'POST', body: JSON.stringify({ email: emailDraft }) })} /></div>}</label>
            <div className={`password-change ${editingPassword ? 'editor-popup' : ''}`}><label>Пароль<div className="phone-display"><input type="password" value="••••••••••••" readOnly aria-label="Поточний пароль прихований" /><button type="button" className="avatar-edit inline-edit" onClick={() => openEditor('password')}>✎</button></div></label>{editingPassword && <div className="password-editor"><button type="button" className="modal-close" onClick={() => setEditingPassword(false)}>×</button><div className="password-current-row"><PasswordInput name="currentPassword" placeholder="Поточний пароль" autoComplete="current-password" /><a href="/?reset-password">Забув пароль</a></div><PasswordInput name="newPassword" placeholder="Новий пароль" autoComplete="new-password" minLength={12} /><PasswordInput name="passwordConfirmation" placeholder="Підтвердження нового паролю" autoComplete="new-password" minLength={12} /><button type="button" className="outline-button compact" onClick={async (event) => { const box = event.currentTarget.parentElement; const currentPassword = (box?.querySelector('[name=currentPassword]') as HTMLInputElement)?.value; const newPassword = (box?.querySelector('[name=newPassword]') as HTMLInputElement)?.value; const confirmation = (box?.querySelector('[name=passwordConfirmation]') as HTMLInputElement)?.value; try { await request('/api/profile/me/password', { method: 'POST', body: JSON.stringify({ currentPassword, newPassword, confirmation }) }); setEditingPassword(false); setPasswordMessage('Пароль змінено') } catch (error) { setPasswordMessage((error as Error).message) } }}>Змінити пароль</button>{passwordMessage && <span className="field-error">{passwordMessage}</span>}</div>}</div>
            <div className="field-row">
                <label>Нікнейм<input name="nickname" defaultValue={profile.nickname ?? ''} maxLength={50} /></label>
            </div>
            <label>Про себе<textarea name="bio" defaultValue={profile.bio ?? ''} rows={3} maxLength={500} placeholder="Розкажіть про свою ферму або господарство" /></label>
            <div className="field-row">
                <label>Резервна електронна пошта<input name="recoveryEmail" type="email" defaultValue={profile.recoveryEmail ?? ''} /></label>
            </div>
            <ProfileLocationFields profile={profile} onChange={(patch) => setProfile((current) => ({ ...current, ...patch }))} onBusyChange={setLocationBusy} />
            <div className="profile-privacy">
                <strong>Видимість телефону</strong>
                <select value={visibility} onChange={(event) => setVisibility(event.target.value)}><option value="private">Не видимий нікому</option><option value="authenticated">Лише авторизованим користувачам</option><option value="public">Видимий усім</option></select>
                <label className="consent-row"><input type="checkbox" checked={consent} onChange={(event) => setConsent(event.target.checked)} /> Підтверджую згоду на розкриття номера телефону</label>
                <button type="button" className="outline-button" onClick={savePrivacy}>Зберегти приватність</button>
            </div>
            {message && <p className="form-error">{message}</p>}
            <div className="field-row"><button className="primary-button" disabled={busy || locationBusy}>{busy ? 'Збереження…' : 'Зберегти профіль'}</button><button type="button" className="outline-button" onClick={logout}>Вийти з акаунта</button></div>
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
