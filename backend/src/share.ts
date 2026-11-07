import type { Request } from 'express'
import { getProduct } from './products.js'
import { getBuyRequest } from './buy-requests.js'
import { getPublicProfile } from './profiles.js'
import { listReviews } from './community-service.js'
import { pool } from './db/client.js'
import { currencyLabel } from './currency-label.js'
import sharp from 'sharp'

export type ShareType = 'product' | 'buy_request' | 'profile' | 'review'
export type SharePayload = { type: ShareType; publicUrl: string; title: string; description: string; previewImage: string; shareText: string }
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const activeRequests = new Set(['open', 'partially_selected', 'partially_completed', 'partially_fulfilled'])
const units: Record<string, string> = { piece: 'шт.', kg: 'кг', ton: 'тонна', litre: 'літр', box: 'ящик' }
const amount = (n: number, currency: string) => `${new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(n)} ${currencyLabel(currency)}`
const short = (s: string, max = 240) => s.replace(/\s+/g, ' ').trim().slice(0, max)

// A fixed configured origin is the only source of absolute URLs; never trust Host.
export function publicOrigin(value = process.env.PUBLIC_ORIGIN ?? 'http://localhost:5173'): string {
    const url = new URL(value)
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Invalid PUBLIC_ORIGIN')
    if (url.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)) throw new Error('PUBLIC_ORIGIN must use HTTPS')
    return url.origin
}
const image = (path: string | null | undefined, origin: string) => {
    if (path && /^\/uploads\/(?!.*(?:\.\.|[?#\\]))[a-zA-Z0-9/_\-.]+$/.test(path)) return origin + path
    if (path) try {
        const url = new URL(path)
        if (url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash && url.hostname.includes('.') && !url.hostname.endsWith('.local') && !/^[\d.]+$/.test(url.hostname) && !url.hostname.includes(':')) return url.href
    } catch { /* Use the brand image for invalid or private URLs. */ }
    return origin + '/brand/logo-mini.png'
}
const avatarPath = async (path: string | null | undefined, username: string) => {
    if (!path?.startsWith('data:')) return path
    if (path.length > 2_000_000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(path)) return null
    const bytes = Buffer.from(path.slice(path.indexOf(',') + 1), 'base64')
    const metadata = await sharp(bytes, { limitInputPixels: 40_000_000 }).metadata().catch(() => null)
    return metadata?.format && ['png', 'jpeg', 'webp', 'gif'].includes(metadata.format) ? `/api/share-avatar/${encodeURIComponent(username)}` : null
}
const make = (type: ShareType, origin: string, path: string, title: string, lines: (string | null | undefined)[], photo?: string | null): SharePayload => {
    const publicUrl = origin + path
    const body = lines.filter(Boolean).join('\n')
    const previewImage = photo && /^\/api\/share-avatar\/[a-z0-9_%.-]+$/i.test(photo) ? origin + photo : image(photo, origin)
    return { type, publicUrl, title: short(title, 120), description: short(body), previewImage, shareText: [title, body, `${type === 'buy_request' ? 'Запропонувати товар' : 'Переглянути'}: ${publicUrl}`].filter(Boolean).join('\n\n') }
}

export async function getSharePayload(type: ShareType, id: string, request: Request, reviewId?: string): Promise<SharePayload | null> {
    const origin = publicOrigin()
    if (type === 'product') {
        if (!uuid.test(id)) return null
        const result = await getProduct(id)
        if (!('product' in result.body) || !result.body.product) return null
        const p = result.body.product
        return make(type, origin, `/products/${encodeURIComponent(p.id)}`, p.title, [p.price ? `Ціна: ${amount(p.price.amount, p.price.currency)}${p.unit ? ` / ${units[p.unit] ?? p.unit}` : ''}` : 'Ціна не вказана', p.quantity != null ? `Кількість: ${p.availableQuantity ?? p.quantity} ${units[p.unit] ?? p.unit}` : null, p.settlement?.name ? `Місто: ${p.settlement.name}` : null, short(p.description), p.owner.username ? `Продавець: ${p.owner.username}` : null], p.photos[0]?.url)
    }
    if (type === 'buy_request') {
        if (!uuid.test(id)) return null
        const result = await getBuyRequest(id)
        if (!('buyRequest' in result.body) || !result.body.buyRequest) return null
        const p = result.body.buyRequest
        if (!activeRequests.has(p.status)) return null
        const price = p.price.max !== null ? `до ${amount(p.price.max, p.price.currency)}` : p.price.min !== null ? `від ${amount(p.price.min, p.price.currency)}` : null
        return make(type, origin, `/buy-requests/${encodeURIComponent(p.id)}`, p.title, [p.quantity != null ? `Потрібно: ${p.quantity} ${units[p.unit] ?? p.unit}` : null, price ? `Бюджет: ${price}${p.unit ? ` / ${units[p.unit] ?? p.unit}` : ''}` : null, p.settlement?.name ? `Місто: ${p.settlement.name}` : null, short(p.description)], p.photos[0]?.url)
    }
    const result = await getPublicProfile(id, { ...request, query: {}, authUser: undefined } as Request)
    if (!('profile' in result.body)) return null
    const p = result.body.profile
    const profilePath = `/profiles/${encodeURIComponent(p.username)}`
    if (type === 'profile') return make(type, origin, profilePath, p.nickname || p.username, [short(p.bio ?? ''), p.sellerRating.count ? `Рейтинг продавця: ${p.sellerRating.average}/12 (${p.sellerRating.count})` : null, p.buyerRating.count ? `Рейтинг покупця: ${p.buyerRating.average}/12 (${p.buyerRating.count})` : null], await avatarPath(p.avatarUrl, p.username))
    if (type !== 'review' || !reviewId || !uuid.test(reviewId)) return null
    const reviews = await listReviews(p.username)
    const review = reviews.body.reviews.find((item: { id: string }) => item.id === reviewId)
    if (!review) return null
    const role = await pool.query(`SELECT CASE WHEN o.seller_id = r.reviewee_id THEN 'продавця' ELSE 'покупця' END AS role FROM reviews r JOIN orders o ON o.id = r.order_id WHERE r.id = $1 AND r.published_at IS NOT NULL AND o.status <> 'cancelled' AND ((o.seller_id = r.reviewee_id AND o.buyer_id = r.reviewer_id) OR (o.buyer_id = r.reviewee_id AND o.seller_id = r.reviewer_id))`, [reviewId])
    if (!role.rowCount) return null
    return make(type, origin, `${profilePath}?review=${encodeURIComponent(reviewId)}`, `Відгук про ${role.rows[0].role} ${p.nickname || p.username}`, [`Оцінка: ${review.rating}/12`, short(review.body ?? ''), review.reviewerUsername ? `Автор: ${review.reviewerUsername}` : null], await avatarPath(p.avatarUrl, p.username))
}

export async function getShareAvatar(username: string, request: Request): Promise<Buffer | null> {
    const result = await getPublicProfile(username, { ...request, query: {}, authUser: undefined } as Request)
    if (!('profile' in result.body) || !result.body.profile) return null
    const value = result.body.profile.avatarUrl
    if (!value || value.length > 2_000_000 || !/^data:image\/(?:png|jpeg|webp|gif);base64,[a-z0-9+/=\s]+$/i.test(value)) return null
    return Buffer.from(value.slice(value.indexOf(',') + 1), 'base64')
}

const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
export function injectShareMetadata(html: string, payload: SharePayload): string {
    const tags: [string, string, string][] = [
        ['property', 'og:title', payload.title], ['property', 'og:description', payload.description], ['property', 'og:image', payload.previewImage], ['property', 'og:url', payload.publicUrl], ['property', 'og:type', 'website'], ['property', 'og:site_name', 'ДещоТреба'], ['property', 'og:locale', 'uk_UA'],
        ['name', 'twitter:card', 'summary_large_image'], ['name', 'twitter:title', payload.title], ['name', 'twitter:description', payload.description], ['name', 'twitter:image', payload.previewImage],
    ]
    return html.replace('</head>', `${tags.map(([attr, name, value]) => `<meta ${attr}="${name}" content="${escapeHtml(value)}" />`).join('\n')}\n<link rel="canonical" href="${escapeHtml(payload.publicUrl)}" />\n</head>`)
}
