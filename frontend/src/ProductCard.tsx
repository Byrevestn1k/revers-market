import { ConvertedPrice } from './product-currency'
import { useEffect, useState } from 'react'
import { listingState, listingStateLabel } from './activity'
import { CategoryImage } from './CategoryPicker'
import { DELIVERY_LABELS, listingPrice, unitLabel } from './listing-options'
import FavoriteButton from './FavoriteButton'
import { deliveryOptionsLabel, type DeliveryOption } from './DeliveryOptionsFields'
import { photoThumbnailUrl } from './photo-thumbnail'
import './listing-ui.css'
import ShareButton from './ShareButton'

export type ProductCardData = {
    id: string; title: string; category: { id: string; name: string; imageIndex?: number | null }
    photos?: { url: string; alt?: string }[]; photoUrl?: string | null
    price?: { amount: number; currency: string }; quantity?: number; availableQuantity?: number
    unit?: string; geoZone: string; deliveryMode?: string; deliveryOptions?: DeliveryOption[] | null; status?: string
    publicAddress?: string
    owner?: { id: string; username?: string; nickname?: string | null }
}
export function ListingPicture({ product, className = '' }: { product: ProductCardData; className?: string }) {
    const url = product.photos?.[0]?.url || product.photoUrl
    const displayUrl = url ? photoThumbnailUrl(url) : null
    const [failed, setFailed] = useState(false)
    useEffect(() => setFailed(false), [url])
    return <span className={'listing-picture ' + className}>{displayUrl && !failed ? <img src={displayUrl.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${displayUrl}` : displayUrl} alt={product.photos?.[0]?.alt || product.title} loading="lazy" onError={() => setFailed(true)} /> : <CategoryImage category={{ ...product.category, parentId: null }} />}</span>
}
export default function ProductCard({ product, onOpen, onEdit, onDelete, onStatus, onChat, favorite = false, onFavorite, showFavorite = true }: {
    product: ProductCardData; onOpen: () => void; onEdit?: () => void; onDelete?: () => void; onStatus?: (status: string) => void; onChat?: () => void; favorite?: boolean; onFavorite?: () => void; showFavorite?: boolean
}) {
    const status = product.status ?? 'active'
    const [needsQuantity, setNeedsQuantity] = useState(false)
    const availableQuantity = product.availableQuantity ?? product.quantity
    useEffect(() => setNeedsQuantity(false), [availableQuantity, status])
    const primaryStatus = status === 'active' ? 'paused' : 'active'
    const actions: Record<string, string> = { draft: 'Зберегти як чернетку', active: 'Активувати', paused: 'Зробити неактивним', sold: 'Позначити проданим', expired: 'Завершити' }
    return <article className="product-card listing-card">
        <button type="button" className="listing-card-open" onClick={onOpen} aria-label={'Відкрити: ' + product.title}>
            <div className="product-image"><ListingPicture product={product} /><span className={'status status-' + listingState('product', status)}>{listingStateLabel('product', status)}</span></div>
            <div className="product-card-body"><small className="listing-category">{product.category.name}</small><h3>{product.title}</h3>
                {product.price && <strong className="price">{listingPrice(product.price.amount, product.price.currency)}{product.unit && <small> / {unitLabel(product.unit)}</small>}</strong>}
                {product.price && <ConvertedPrice amount={product.price.amount} currency={product.price.currency} />}
                <p>⌖ {product.publicAddress || product.geoZone}</p>
                <div className="card-meta"><span>{product.availableQuantity ?? product.quantity} {unitLabel(product.unit)}</span><span>{product.deliveryOptions?.length ? deliveryOptionsLabel(product.deliveryOptions) : DELIVERY_LABELS[product.deliveryMode ?? ''] ?? ''}</span></div>
                {product.owner?.username && <small className="listing-owner">{product.owner.nickname || product.owner.username}</small>}
            </div>
        </button>
        {showFavorite && <FavoriteButton targetType="product" targetId={product.id} favorite={favorite} onFavorite={onFavorite ? () => onFavorite() : undefined} />}
        {status === 'active' && <ShareButton type="product" id={product.id} />}
        {(onChat || onEdit || onDelete || onStatus) && <div className="listing-card-actions">
            {onChat && <button type="button" className="primary-button compact" onClick={onChat}>♧ Написати продавцю</button>}
            {onEdit && <button type="button" className="outline-button compact" onClick={onEdit}>Редагувати</button>}
            {onDelete && <button type="button" className="outline-button compact" onClick={onDelete}>Видалити</button>}
            {onStatus && <><button type="button" className="outline-button compact" onClick={() => { if (primaryStatus === 'active' && availableQuantity !== undefined && availableQuantity <= 0) setNeedsQuantity(true); else onStatus(primaryStatus) }}>{status === 'active' ? 'Призупинити' : status === 'draft' ? 'Опублікувати' : 'Відновити'}</button>{needsQuantity && <div className="stock-message" role="status"><p>Щоб знову продавати товар, спочатку вкажіть доступну кількість</p>{product.quantity !== undefined && availableQuantity !== undefined && product.quantity > availableQuantity && <p>Зарезервовано: {product.quantity - availableQuantity} {unitLabel(product.unit)}. У формі вкажіть загальну кількість з урахуванням резерву.</p>}{onEdit && <button type="button" className="outline-button compact" onClick={onEdit}>Вказати кількість</button>}</div>}<label>Інші дії<select value="" onChange={(event) => { if (event.target.value) onStatus(event.target.value) }}><option value="">Оберіть дію</option>{Object.entries(actions).filter(([value]) => value !== status && value !== primaryStatus).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></>}
        </div>}
    </article>
}
