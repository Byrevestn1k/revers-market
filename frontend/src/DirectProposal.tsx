import { useRef, useState, type FormEvent } from 'react'
import type { DeliveryOption } from './DeliveryOptionsFields'
import { unitLabel } from './listing-options'

export type DirectContext = { title: string; buyerId: string; sellerId: string; unit: string; currency: string; price: number; remaining: number; available: boolean; termsToken: string; deliveryOptions?: DeliveryOption[] | null }
export type DirectProposal = { id: string; createdBy: string; price: number; quantity: number; currency: string; unit: string; delivery: string; postalOperator?: string | null; deliveryPrice: number; comment: string; status: string; orderId?: string | null; createdAt: string }
const labels: Record<string, string> = { SELF_PICKUP: 'Самовивіз', SELLER_DELIVERY: 'Доставка продавцем', POSTAL_DELIVERY: 'Поштова доставка' }
const operators: Record<string, string> = { NOVA_POSHTA: 'Нова пошта', UKRPOSHTA: 'Укрпошта' }

export function DirectProposalForm({ context, initial, parentId, busy, onSubmit, onCancel }: { context: DirectContext; initial?: DirectProposal; parentId?: string | null; busy: boolean; onSubmit: (value: Record<string, unknown>) => void; onCancel: () => void }) {
    const key = useRef(crypto.randomUUID())
    const options = context.deliveryOptions ?? []
    const flexible = options.some(option => option.method === 'FLEXIBLE')
    const methods = ['SELF_PICKUP', 'SELLER_DELIVERY', 'POSTAL_DELIVERY'].filter(method => (options.some(option => option.method === method) || flexible) && (method !== 'POSTAL_DELIVERY' || options.some(option => option.method === method && option.postalOperators?.length)))
    const [delivery, setDelivery] = useState(initial?.delivery && methods.includes(initial.delivery) ? initial.delivery : methods[0] ?? '')
    const [price, setPrice] = useState(String(initial?.price ?? context.price))
    const [quantity, setQuantity] = useState(String(initial?.quantity ?? Math.min(1, context.remaining)))
    const postal = options.find(option => option.method === 'POSTAL_DELIVERY')?.postalOperators ?? []
    const submit = (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault()
        const data = new FormData(event.currentTarget)
        onSubmit({ action: 'propose', parentId: initial?.id ?? parentId ?? null, requestKey: key.current, expectedTermsToken: context.termsToken, expectedCurrency: context.currency, expectedUnit: context.unit, expectedProductPrice: context.price, expectedDeliveryOptions: context.deliveryOptions ?? null, price: Number(data.get('price')), quantity: Number(data.get('quantity')), delivery, postalOperator: delivery === 'POSTAL_DELIVERY' ? data.get('postalOperator') : null, deliveryPrice: Number(data.get('deliveryPrice')), comment: data.get('comment') })
    }
    return <form className="offer-form direct-proposal-form" onSubmit={submit}>
        <h3>{initial ? 'Запропонувати інші умови' : 'Запропонувати угоду'}</h3>
        <p>{context.title} · валюта угоди: {context.currency}</p>
        <div className="field-row"><label>Ціна за {unitLabel(context.unit)} ({context.currency})<input name="price" type="number" min="0" step="0.0001" value={price} onChange={event => setPrice(event.target.value)} required /></label><label>Кількість ({unitLabel(context.unit)})<input name="quantity" type="number" min="0.001" step="0.001" max={context.remaining} value={quantity} onChange={event => setQuantity(event.target.value)} required /></label></div>
        <p>Вартість товару: {(Number(price) * Number(quantity)).toLocaleString('uk-UA', { maximumFractionDigits: 4 })} {context.currency} (без доставки)</p>
        <p>Доступно: {context.remaining} {unitLabel(context.unit)}</p>
        {methods.length ? <><label>Спосіб отримання<select value={delivery} onChange={event => setDelivery(event.target.value)} required>{methods.map(method => <option key={method} value={method}>{labels[method]}</option>)}</select></label>{delivery === 'POSTAL_DELIVERY' && <label>Поштовий оператор<select name="postalOperator" defaultValue={initial?.postalOperator ?? ''} required><option value="">Оберіть оператора</option>{postal.map(operator => <option key={operator} value={operator}>{operators[operator]}</option>)}</select></label>}</> : <p className="form-error">Продавцю потрібно уточнити доступні способи отримання.</p>}
        <label>Вартість доставки ({context.currency})<input name="deliveryPrice" type="number" min="0" step="0.01" defaultValue={initial?.deliveryPrice ?? 0} required /></label><label>Коментар продавцю<textarea name="comment" maxLength={1000} defaultValue={initial?.comment ?? ''} /></label>
        <div className="deal-actions"><button type="button" className="outline-button" onClick={onCancel} disabled={busy}>Скасувати</button><button className="primary-button" disabled={busy || !methods.length || !context.available}>Надіслати пропозицію</button></div>
    </form>
}

export function DirectProposalCard({ proposal, viewer, busy, onAction, onCounter }: { proposal: DirectProposal; context: DirectContext; viewer: string; busy: boolean; onAction: (action: string, proposal: DirectProposal) => void; onCounter: (proposal: DirectProposal) => void }) {
    return <article id={`direct-proposal-${proposal.id}`} tabIndex={-1} className="negotiation-card"><strong>{proposal.createdBy === viewer ? 'Ви запропонували' : 'Інша сторона пропонує'}</strong><p>{proposal.quantity} {unitLabel(proposal.unit)} × {proposal.price} {proposal.currency} за одиницю</p><p>Разом за товар: {proposal.quantity * proposal.price} {proposal.currency}</p><p>{labels[proposal.delivery] ?? proposal.delivery}{proposal.postalOperator ? ` · ${operators[proposal.postalOperator] ?? proposal.postalOperator}` : ''} · доставка: {proposal.deliveryPrice} {proposal.currency}</p>{proposal.comment && <p>{proposal.comment}</p>}<p>{({ pending: 'Очікує відповіді', accepted: 'Умови погоджено', rejected: 'Відхилено', withdrawn: 'Відкликано', countered: 'Умови змінено' } as Record<string, string>)[proposal.status] ?? proposal.status}</p>{proposal.orderId && <a href={"/orders?order=" + encodeURIComponent(proposal.orderId)}>Переглянути угоду</a>}{proposal.status === 'pending' && <div className="deal-actions">{proposal.createdBy !== viewer ? <><button className="primary-button compact" disabled={busy} onClick={() => onAction('accept', proposal)}>Прийняти умови</button><button className="outline-button compact" disabled={busy} onClick={() => onCounter(proposal)}>Запропонувати інші умови</button><button className="text-button" disabled={busy} onClick={() => onAction('reject', proposal)}>Відхилити</button></> : <button className="text-button" disabled={busy} onClick={() => onAction('withdraw', proposal)}>Відкликати</button>}</div>}</article>
}
