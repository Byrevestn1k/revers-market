import FavoriteButton, { type FavoriteTargetType } from './FavoriteButton'
import type { ReactNode } from 'react'
import { receiptLabel, type ReceiptMethod } from './subscription-criteria'
import { requestBudget, unitLabel } from './listing-options'
import { ListingPicture } from './ProductCard'

export type BuyRequestCardData = {
    id: string
    title: string
    description?: string
    category: { id: string; name: string; imageIndex?: number | null }
    quantity: number
    unit: string
    geoArea: string
    status: string
    price: { min: number | null; max: number | null; currency: string }
    photos?: { url: string; alt?: string }[]
    createdAt?: string
    receiptMethod?: ReceiptMethod | null
}

const REQUEST_STATUS: Record<string, string> = {
    open: 'Відкритий', partially_selected: 'Частково обрано', partially_completed: 'Частково отримано',
    partially_fulfilled: 'Частково виконано', completed: 'Завершений', fulfilled: 'Виконаний',
    cancelled: 'Скасований', expired: 'Завершений',
}

export default function BuyRequestCard({ item, onOpen, favorite = false, onFavorite, showDescription = true, showFavorite = true, children }: {
    item: BuyRequestCardData
    onOpen: () => void
    favorite?: boolean
    onFavorite?: (targetType: FavoriteTargetType, targetId: string) => Promise<void> | void
    showDescription?: boolean
    showFavorite?: boolean
    children?: ReactNode
}) {
    return <article className={`request-card buy-request-card listing-card${showFavorite ? '' : ' no-favorite'}`}>
        <button type="button" className="buy-request-card-open" onClick={onOpen} aria-label={'Відкрити запит: ' + item.title}>
            <span className="buy-request-card-image"><ListingPicture product={{ id: item.id, title: item.title, category: item.category, geoZone: item.geoArea, photos: item.photos }} /></span>
            <header><div><span className="eyebrow">{item.category.name}</span><h3>{item.title}</h3></div><span className={`status status-${item.status}`}>{REQUEST_STATUS[item.status] ?? item.status}</span></header>
            {showDescription && <p>{item.description || 'Опис не додано.'}</p>}
            <div className="card-meta"><span>▧ {item.quantity} {unitLabel(item.unit)}</span><span>{requestBudget(item.price)}</span><span>⌖ {item.geoArea}</span>{item.receiptMethod && <span>{receiptLabel(item.receiptMethod)}</span>}{item.createdAt && <span>{new Date(item.createdAt).toLocaleDateString('uk-UA')}</span>}</div>
        </button>
        {children}
        {showFavorite && <FavoriteButton targetType="buy_request" targetId={item.id} favorite={favorite} onFavorite={onFavorite} />}
    </article>
}
