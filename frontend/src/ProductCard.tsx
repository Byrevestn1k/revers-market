import { useEffect, useState } from 'react'
import { CategoryImage } from './CategoryPicker'
import { DELIVERY_LABELS, LISTING_STATUS, listingPrice, unitLabel } from './listing-options'
import './listing-ui.css'

export type ProductCardData = {
    id: string; title: string; category: { id: string; name: string; imageIndex?: number | null }
    photos?: { url: string; alt?: string }[]; photoUrl?: string | null
    price?: { amount: number; currency: string }; quantity?: number; availableQuantity?: number
    unit?: string; geoZone: string; deliveryMode?: string; status?: string
    publicAddress?: string
    owner?: { id: string; username?: string; nickname?: string | null }
}
export function ListingPicture({ product, className = '' }: { product: ProductCardData; className?: string }) {
    const url = product.photos?.[0]?.url || product.photoUrl
    const [failed, setFailed] = useState(false)
    useEffect(() => setFailed(false), [url])
    return <span className={'listing-picture ' + className}>{url && !failed ? <img src={url.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${url}` : url} alt={product.photos?.[0]?.alt || product.title} loading="lazy" onError={() => setFailed(true)} /> : <CategoryImage category={{ ...product.category, parentId: null }} />}</span>
}
export default function ProductCard({ product, onOpen, onEdit, onDelete, onStatus, onChat }: {
    product: ProductCardData; onOpen: () => void; onEdit?: () => void; onDelete?: () => void; onStatus?: (status: string) => void; onChat?: () => void
}) {
    const status = product.status ?? 'active'
    return <article className="product-card listing-card">
        <button type="button" className="listing-card-open" onClick={onOpen} aria-label={'Відкрити: ' + product.title}>
            <div className="product-image"><ListingPicture product={product} /><span className={'status status-' + status}>{LISTING_STATUS[status] ?? status}</span></div>
            <div className="product-card-body"><small className="listing-category">{product.category.name}</small><h3>{product.title}</h3>
                {product.price && <strong className="price">{listingPrice(product.price.amount, product.price.currency)}{product.unit && <small> / {unitLabel(product.unit)}</small>}</strong>}
                <p>⌖ {product.publicAddress || product.geoZone}</p>
                <div className="card-meta"><span>{product.availableQuantity ?? product.quantity} {unitLabel(product.unit)}</span><span>{DELIVERY_LABELS[product.deliveryMode ?? ''] ?? ''}</span></div>
                {product.owner?.username && <small className="listing-owner">{product.owner.nickname || product.owner.username}</small>}
            </div>
        </button>
        {(onChat || onEdit || onDelete || onStatus) && <div className="listing-card-actions">
            {onChat && <button type="button" className="primary-button compact" onClick={onChat}>♧ Написати продавцю</button>}
            {onEdit && <button type="button" className="outline-button compact" onClick={onEdit}>Редагувати</button>}
            {onDelete && <button type="button" className="outline-button compact" onClick={onDelete}>Видалити</button>}
            {onStatus && <label>Статус<select value={status} onChange={(event) => onStatus(event.target.value)}>{Object.entries(LISTING_STATUS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>}
        </div>}
    </article>
}
