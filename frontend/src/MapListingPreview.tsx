import type { SellerProductPoint } from './map-sellers'
import { DELIVERY_LABELS, unitLabel } from './listing-options'

export default function MapListingPreview({ item, description, loading, error, onOpen, onOwner, onMap, imageUrl }: {
    item: SellerProductPoint; description?: string; loading: boolean; error?: string
    onOpen: () => void; onOwner: () => void; onMap: () => void; imageUrl: (url: string) => string
}) {
    const price = item.price ? new Intl.NumberFormat('uk-UA', { maximumFractionDigits: 2 }).format(item.price.amount) + ' ' + item.price.currency : ''
    return <section className="map-listing-preview" aria-label="Коротка інформація про оголошення" aria-live="polite">
        <div className="map-preview-media"><span aria-hidden="true">{item.kind === 'buyRequest' ? 'Шукає' : item.category.name}</span>{item.photoUrl && <img src={imageUrl(item.photoUrl)} alt={item.title} onError={event => { event.currentTarget.hidden = true }} />}</div>
        <span className="eyebrow">{item.kind === 'buyRequest' ? 'Запит покупця' : item.category.name}</span>
        <h3>{item.title}</h3>
        {price && <strong className="map-preview-price">{price}{item.unit && <small> / {unitLabel(item.unit)}</small>}</strong>}
        <dl className="map-preview-facts">
            {item.quantity !== undefined && <div><dt>{item.kind === 'buyRequest' ? 'Потрібно' : 'Доступно'}</dt><dd>{item.quantity} {unitLabel(item.unit ?? '')}</dd></div>}
            {item.deliveryMode && <div><dt>Доставка</dt><dd>{DELIVERY_LABELS[item.deliveryMode as keyof typeof DELIVERY_LABELS] ?? item.deliveryMode}</dd></div>}
            <div><dt>Місце</dt><dd>{item.publicAddress || item.geoZone}{item.approximate !== false && <small>Приблизне розташування</small>}</dd></div>
            <div><dt>Відстань</dt><dd>{item.distanceBand} від точки пошуку</dd></div>
        </dl>
        {loading ? <p role="status">Завантажуємо опис…</p> : description ? <p className="map-preview-description">{description}</p> : <p className="map-preview-muted">{error || 'Опис ще не додано.'}</p>}
        {item.owner && <button type="button" className="map-preview-owner" onClick={onOwner}>{item.kind === 'buyRequest' ? 'Покупець' : 'Продавець'}: {item.owner.nickname || item.owner.username} <span>Профіль →</span></button>}
        <div className="map-preview-actions"><button type="button" className="primary-button compact" onClick={onOpen}>{item.kind === 'buyRequest' ? 'Відкрити запит' : 'Відкрити товар'} →</button><button type="button" className="outline-button compact" onClick={onMap}>На мапі</button></div>
    </section>
}
