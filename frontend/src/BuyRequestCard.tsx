import FavoriteButton, { type FavoriteTargetType } from './FavoriteButton'
import type { ReactNode } from 'react'
import { receiptLabel, type ReceiptMethod } from './subscription-criteria'
import { unitLabel } from './listing-options'

export type BuyRequestCardData = {
    id: string
    title: string
    description?: string
    category: { id: string; name: string }
    quantity: number
    unit: string
    geoArea: string
    status: string
    price: { min: number | null; max: number | null; currency: string }
    receiptMethod?: ReceiptMethod | null
}

const REQUEST_STATUS: Record<string, string> = {
    open: 'Відкритий', partially_selected: 'Частково обрано', partially_completed: 'Частково отримано',
    partially_fulfilled: 'Частково виконано', completed: 'Завершений', fulfilled: 'Виконаний',
    cancelled: 'Скасований', expired: 'Завершений',
}

export default function BuyRequestCard({ item, onOpen, favorite = false, onFavorite, showDescription = true, children }: {
    item: BuyRequestCardData
    onOpen: () => void
    favorite?: boolean
    onFavorite?: (targetType: FavoriteTargetType, targetId: string) => Promise<void> | void
    showDescription?: boolean
    children?: ReactNode
}) {
    return <article className="request-card buy-request-card listing-card">
        <button type="button" className="buy-request-card-open" onClick={onOpen} aria-label={'Відкрити запит: ' + item.title}>
            <header><div><span className="eyebrow">{item.category.name}</span><h3>{item.title}</h3></div><span className={`status status-${item.status}`}>{REQUEST_STATUS[item.status] ?? item.status}</span></header>
            {showDescription && <p>{item.description || 'Опис не додано.'}</p>}
            <div className="card-meta"><span>▧ {item.quantity} {unitLabel(item.unit)}</span><span>₴ {item.price.min ?? '—'}–{item.price.max ?? '—'} {item.price.currency}</span><span>⌖ {item.geoArea}</span>{item.receiptMethod && <span>{receiptLabel(item.receiptMethod)}</span>}</div>
        </button>
        {children}
        <FavoriteButton targetType="buy_request" targetId={item.id} favorite={favorite} onFavorite={onFavorite} />
    </article>
}
