import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { unitLabel } from './listing-options'
import './deal-interaction.css'

type Http = (path: string, options?: RequestInit) => Promise<any>
type Notify = (message: string) => void
export type DealRequest = { id: string; title: string; quantity: number; selectedQuantity: number; completedQuantity: number; remainingQuantity: number; fulfillmentMode: string; unit: string; status: string; deadline?: string | null }
export type DealOffer = { id: string; buyRequestId: string; seller: { id: string; username: string; rating?: number | null; completedDeals?: number; avatarUrl?: string }; quantity: number; acceptedQuantity: number; unit: string; price: { amount: number; currency: string }; delivery: string; note: string; status: string; validUntil?: string | null; additionalPhotoUrl?: string; termsSnapshot?: {availableAt?: string}; deliverySnapshot?: {price?: number}; existingProduct?: { title: string }; photos?: { url: string }[] }
type Proposal = { id: string; createdBy: string; price: number; quantity: number; delivery: string; deliveryPrice: number; status: string; comment: string; createdAt: string }
type Context = { offerId: string; requestId: string; title: string; buyerId: string; sellerId: string; unit: string; currency: string; price: number; quantity: number; remaining: number; delivery: string; deliveryPrice: number; fulfillmentMode: string; available: boolean }
const amount = (value: number, currency: string) => `${new Intl.NumberFormat('uk-UA').format(value)} ${currency}`
const post = (body: unknown): RequestInit => ({ method: 'POST', body: JSON.stringify(body) })
const activeRequest = (item: DealRequest) => ['open','partially_selected','partially_completed','partially_fulfilled'].includes(item.status) && (!item.deadline || new Date(item.deadline) > new Date())

export function OrderContact({ id, http }: { id: string; http: Http }) {
    const [contact, setContact] = useState<{phone: string | null; message: string | null} | null>(null)
    const [error, setError] = useState('')
    const [busy, setBusy] = useState(false)
    return <span>{contact ? contact.phone ? <a className="outline-button" href={`tel:${contact.phone}`}>Зателефонувати: {contact.phone}</a> : <small>{contact.message}</small> : <button className="text-button" disabled={busy} onClick={async () => { setBusy(true); try { setContact(await http(`/api/orders/${id}/contact`)) } catch(caught) {setError((caught as Error).message)} finally {setBusy(false)} }}>Показати телефон</button>}{error && <small role="alert">{error}</small>}</span>
}

export function ParticipantActions({ id, http, notify }: { id: string; http: Http; notify: Notify }) {
    const [busy, setBusy] = useState(false)
    const [blocked, setBlocked] = useState(false)
    const act = async (block: boolean) => {
        if (busy) return
        const reason = block ? '' : window.prompt('Коротко опишіть причину скарги:')
        if (!block && !reason?.trim()) return
        if (block && !window.confirm(blocked ? 'Розблокувати користувача?' : 'Заблокувати нові повідомлення та взаємодії з цим користувачем?')) return
        setBusy(true)
        try { await http(block ? `/api/users/${id}/block` : '/api/reports', block && blocked ? {method:'DELETE'} : post(block ? {} : {targetType:'user',targetId:id,reason:reason!.slice(0,160)})); if (block) setBlocked(!blocked); notify(block ? blocked ? 'Користувача розблоковано' : 'Користувача заблоковано' : 'Скаргу надіслано') } catch(caught) {notify((caught as Error).message)} finally {setBusy(false)}
    }
    return <div className="deal-actions"><button className="text-button" disabled={busy} onClick={() => act(false)}>Поскаржитися</button><button className="text-button" disabled={busy} onClick={() => act(true)}>{blocked ? 'Розблокувати' : 'Заблокувати користувача'}</button></div>
}

export function DealDialog({ title, onClose, children, busy = false, embedded = false }: { title: string; onClose: () => void; children: ReactNode; busy?: boolean; embedded?: boolean }) {
    const ref = useRef<HTMLDialogElement>(null)
    useEffect(() => { const element = ref.current; element?.showModal(); return () => element?.close() }, [])
    if (embedded) return <section className="deal-dialog deal-chat-embedded" aria-label={title}><header><h2>{title}</h2><button type="button" className="icon-button" disabled={busy} aria-label="Закрити" onClick={onClose}>×</button></header>{children}</section>
    return <dialog className="deal-dialog" ref={ref} onCancel={event => { event.preventDefault(); if (!busy) onClose() }} aria-label={title}>
        <header><h2>{title}</h2><button type="button" className="icon-button" disabled={busy} aria-label="Закрити" onClick={onClose}>×</button></header>{children}
    </dialog>
}

export function SelectOfferDialog({ offer, item, http, onClose, onDone }: { offer: DealOffer; item: DealRequest; http: Http; onClose: () => void; onDone: () => void }) {
    const [quantity, setQuantity] = useState(Math.min(offer.quantity - offer.acceptedQuantity, item.remainingQuantity))
    const [agreed, setAgreed] = useState<Proposal | null>(null)
    const [ready, setReady] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const key = useRef(crypto.randomUUID())
    const sending = useRef(false)
    const [maximum, setMaximum] = useState(Math.min(offer.quantity - offer.acceptedQuantity, item.remainingQuantity))
    const [basePrice, setBasePrice] = useState(offer.price.amount)
    const [delivery, setDelivery] = useState(offer.delivery)
    const [baseDeliveryPrice, setBaseDeliveryPrice] = useState(offer.deliverySnapshot?.price ?? 0)
    const load = async () => {
        setReady(false)
        try {
            const result = await http(`/api/offers/${offer.id}/conversation`, post({}))
            const data = await http(`/api/conversations/${result.conversation.id}/context`)
            const latest = [...data.proposals].reverse().find((p: Proposal) => p.status === 'accepted') as Proposal | undefined
            const accepted = latest?.status === 'accepted' ? latest : null
            setAgreed(accepted)
            if (data.context) {
                const max = Math.min(data.context.quantity, data.context.remaining)
                setMaximum(max); setBasePrice(data.context.price); setDelivery(data.context.delivery); setBaseDeliveryPrice(data.context.deliveryPrice ?? 0)
                setQuantity(accepted?.quantity ?? (item.fulfillmentMode === 'single_seller' ? data.context.remaining : max))
                if (!data.context.available) { setError('Пропозиція вже неактуальна або запит закрито.'); return }
            }
            setReady(true)
        } catch (caught) { setError((caught as Error).message) }
    }
    useEffect(() => { void load() }, [offer.id])
    const price = agreed?.price ?? basePrice
    const deliveryPrice = agreed?.deliveryPrice ?? baseDeliveryPrice
    const submit = async (event: FormEvent) => {
        event.preventDefault(); if (sending.current || !ready) return
        sending.current = true; setBusy(true); setError('')
        try { await http(`/api/offers/${offer.id}/accept`, post({ quantity, selectionKey: key.current, expectedPrice: price, expectedDelivery: agreed?.delivery ?? delivery, expectedDeliveryPrice: deliveryPrice, negotiationProposalId: agreed?.id ?? null })); onDone() }
        catch (caught) { await load(); setError((caught as Error).message) }
        finally { sending.current = false; setBusy(false) }
    }
    return <DealDialog title="Домовитися з продавцем?" onClose={onClose} busy={busy}><form onSubmit={submit}>
        <p><strong>{offer.seller.username}</strong><br />{item.title}</p>
        {agreed && <p className="form-hint">Використовуємо погоджені в чаті умови.</p>}
        <label>Кількість ({unitLabel(offer.unit)})<input type="number" min="0.001" step="0.001" max={maximum} value={quantity} readOnly={item.fulfillmentMode === 'single_seller' || Boolean(agreed)} onChange={e => setQuantity(Number(e.target.value))} required /></label>
        <small>Зараз можна обрати до {maximum} {unitLabel(offer.unit)}.</small>
        <dl className="deal-totals"><dt>Ціна за {unitLabel(offer.unit)}</dt><dd>{amount(price, offer.price.currency)}</dd><dt>Товар</dt><dd>{amount(Math.round(quantity * price * 100) / 100, offer.price.currency)}</dd><dt>Отримання</dt><dd>{agreed?.delivery ?? delivery}</dd>{deliveryPrice > 0 && <><dt>Доставка</dt><dd>{amount(deliveryPrice, offer.price.currency)}</dd></>}<dt>Разом</dt><dd><strong>{amount(Math.round(quantity * price * 100) / 100 + deliveryPrice, offer.price.currency)}</strong></dd></dl>
        <p className="form-hint">Оплата та передача товару відбуваються безпосередньо між вами та продавцем.</p>
        {error && <p className="form-error" role="alert">{error}</p>}
        <div className="deal-actions"><button type="button" className="outline-button" disabled={busy} onClick={onClose}>Назад</button><button className="primary-button" disabled={busy || !ready || quantity <= 0 || quantity > maximum}>{busy ? 'Зберігаємо…' : 'Обрати і домовитися'}</button></div>
    </form></DealDialog>
}

export function RequestOffers({ item, http, notify, onRefresh }: { item: DealRequest; http: Http; notify: Notify; onRefresh: () => void }) {
    const [offers, setOffers] = useState<DealOffer[]>([])
    const [orders, setOrders] = useState<any[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [sort, setSort] = useState('new')
    const [onlyAvailable, setOnlyAvailable] = useState(false)
    const [selection, setSelection] = useState<DealOffer | null>(null)
    const [chat, setChat] = useState<{ conversationId: string; title: string } | null>(null)
    const [busy, setBusy] = useState(false)
    const load = async () => {
        try { const [result, deals] = await Promise.all([http(`/api/buy-requests/${item.id}/offers`), http('/api/orders')]); setOffers(result.offers); setOrders(deals.orders.filter((o: any) => o.buyRequestId === item.id)); setError('') }
        catch (caught) { setError((caught as Error).message) } finally { setLoading(false) }
    }
    useEffect(() => { void load() }, [item.id, item.remainingQuantity])
    const contact = async (offer: DealOffer) => { if (busy) return; setBusy(true); try { const data = await http(`/api/offers/${offer.id}/conversation`, post({})); setChat({ conversationId: data.conversation.id, title: offer.seller.username }) } catch (caught) { notify((caught as Error).message) } finally { setBusy(false) } }
    const selectable = (offer: DealOffer) => activeRequest(item) && item.remainingQuantity > 0 && ['submitted','partially_accepted'].includes(offer.status) && (!offer.validUntil || new Date(offer.validUntil) > new Date()) && offer.quantity > offer.acceptedQuantity && (item.fulfillmentMode !== 'single_seller' || (item.selectedQuantity === 0 && offer.quantity - offer.acceptedQuantity >= item.remainingQuantity))
    const sorted = [...offers].filter(o => !onlyAvailable || selectable(o)).sort((a,b) => sort === 'price' ? a.price.amount - b.price.amount : sort === 'rating' ? (b.seller.rating ?? 0) - (a.seller.rating ?? 0) : 0)
    return <section className="request-offers">
        <div className="request-progress" aria-label="Виконання запиту"><div className="request-progress-bar"><span style={{ width: `${item.completedQuantity / item.quantity * 100}%` }} /><i style={{ width: `${item.selectedQuantity / item.quantity * 100}%` }} /></div><p>Отримано: <b>{item.completedQuantity}</b> · Домовлено: <b>{item.selectedQuantity}</b> · Ще потрібно: <b>{item.remainingQuantity} {unitLabel(item.unit)}</b></p>{item.remainingQuantity === 0 && item.completedQuantity < item.quantity && <p>Увесь потрібний обсяг уже погоджено. Очікуємо завершення угод.</p>}</div>
        {orders.length > 0 && <details><summary>Ваші домовленості ({orders.length})</summary>{orders.map(order => <p key={order.id}><a href="/?view=orders">{order.seller.username} — {order.actualQuantity ?? order.quantity} {unitLabel(item.unit)}</a> · {dealStatusText(order, order.buyer.id)}</p>)}</details>}
        <div className="deal-actions"><h3>Пропозиції ({offers.length})</h3><label>Сортування<select value={sort} onChange={e => setSort(e.target.value)}><option value="new">За часом</option><option value="price">Найдешевші</option><option value="rating">За рейтингом</option></select></label><label><input type="checkbox" checked={onlyAvailable} onChange={e => setOnlyAvailable(e.target.checked)} /> Доступні для вибору</label></div>
        {loading && <p role="status">Завантажуємо пропозиції…</p>}{error && <p role="alert" className="form-error">{error}</p>}
        {!loading && !offers.length && <p>Пропозицій поки немає. Ми повідомимо, коли продавці відгукнуться.</p>}
        {sorted.map(offer => <article key={offer.id} className="deal-offer"><header><div><a href={`/profiles/${encodeURIComponent(offer.seller.username)}`}><strong>{offer.seller.username}</strong></a><small>★ {offer.seller.rating ?? '—'}/12 · {offer.seller.completedDeals ?? 0} підтверджених угод</small></div><strong>{amount(offer.price.amount, offer.price.currency)} / {unitLabel(offer.unit)}</strong></header>
            <h4>{offer.existingProduct?.title ?? item.title}</h4>{offer.additionalPhotoUrl && <img className="deal-offer-photo" src={offer.additionalPhotoUrl} alt="Фото пропозиції" />}
            <p>Пропонує до {offer.quantity - offer.acceptedQuantity} {unitLabel(offer.unit)} · {offer.delivery}</p><p>{offer.note}</p>
            {item.fulfillmentMode === 'multiple_sellers' && <p>Ви можете обрати до {Math.max(0, Math.min(offer.quantity - offer.acceptedQuantity, item.remainingQuantity))} {unitLabel(offer.unit)}.</p>}
            {item.fulfillmentMode === 'single_seller' && offer.quantity - offer.acceptedQuantity < item.remainingQuantity && <p className="form-hint">Ця пропозиція не покриває весь потрібний обсяг. Для цього запиту ви обрали покупку в одного продавця.</p>}
            {!selectable(offer) && !(item.fulfillmentMode === 'single_seller' && offer.quantity - offer.acceptedQuantity < item.remainingQuantity) && <p className="form-hint">{item.remainingQuantity <= 0 ? 'Увесь обсяг уже погоджено.' : 'Зараз ця пропозиція недоступна для вибору.'}</p>}
            <div className="deal-actions"><button className="outline-button" disabled={busy} onClick={() => contact(offer)}>Написати продавцю</button><button className="primary-button" disabled={!selectable(offer)} onClick={() => setSelection(offer)}>Обрати пропозицію</button></div>
            <details onToggle={e => {if (e.currentTarget.open) void http(`/api/offers/${offer.id}/view`, post({})).catch(() => undefined)}}><summary>Детальніше та інші дії</summary><p>Доставка: {offer.delivery}. {offer.validUntil ? `Актуальна до ${new Date(offer.validUntil).toLocaleDateString('uk-UA')}` : 'Строк не вказано.'}</p><button className="text-button" onClick={() => contact(offer)}>Запропонувати інші умови</button>{['submitted','partially_accepted'].includes(offer.status) && offer.acceptedQuantity === 0 && <button className="text-button" onClick={async () => { if (!confirm('Відхилити цю пропозицію?')) return; try { await http(`/api/offers/${offer.id}/reject`, post({})); void load() } catch (caught) { notify((caught as Error).message) } }}>Відхилити пропозицію</button>}<ParticipantActions id={offer.seller.id} http={http} notify={notify} /></details>
        </article>)}
        {selection && <SelectOfferDialog offer={selection} item={item} http={http} onClose={() => setSelection(null)} onDone={() => { setSelection(null); notify('Ви обрали пропозицію. Очікуємо підтвердження продавця.'); onRefresh(); void load() }} />}
        {chat && <DealChat chat={chat} http={http} notify={notify} onClose={() => { setChat(null); onRefresh(); void load() }} />}
    </section>
}

export function DealChat({ chat, http, notify, onClose, embedded = false }: { chat: { conversationId: string; title: string }; http: Http; notify: Notify; onClose: () => void; embedded?: boolean }) {
    const [messages, setMessages] = useState<any[]>([])
    const [proposals, setProposals] = useState<Proposal[]>([])
    const [context, setContext] = useState<Context | null>(null)
    const [viewer, setViewer] = useState('')
    const [text, setText] = useState('')
    const [editing, setEditing] = useState(false)
    const editingParent = useRef<string | null>(null)
    const [selecting, setSelecting] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const sending = useRef(false)
    const load = async () => {
        const [result, details] = await Promise.all([http(`/api/conversations/${chat.conversationId}/messages`), http(`/api/conversations/${chat.conversationId}/context`)])
        setMessages(result.messages); setContext(details.context); setProposals(details.proposals)
        await http(`/api/conversations/${chat.conversationId}/read`, { method: 'PATCH' })
    }
    useEffect(() => { let alive = true; const refresh = () => { if (alive) void load().catch(caught => { if (alive) setError(caught.message) }) }; refresh(); http('/api/profile/me').then(result => { if (alive) setViewer(result.profile.id) }).catch(caught => setError(caught.message)); const timer = window.setInterval(refresh, 4000); return () => { alive = false; clearInterval(timer) } }, [chat.conversationId])
    const act = async (path: string, body: unknown, done?: () => void) => {
        if (sending.current) return
        sending.current = true; setBusy(true); setError('')
        try { await http(path, post(body)); done?.(); await load() } catch (caught) { setError((caught as Error).message); await load().catch(() => undefined) } finally { sending.current = false; setBusy(false) }
    }
    const latest = proposals.at(-1)
    const editTerms = () => { editingParent.current = latest?.id ?? null; setEditing(true) }
    const negotiate = (action: string, proposal: Proposal) => act(`/api/conversations/${chat.conversationId}/negotiations`, { action, proposalId: proposal.id })
    const timeline = [...messages.map(m => ({ ...m, entryType: 'message' })), ...proposals.map(p => ({ ...p, entryType: 'proposal' }))].sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
    return <DealDialog title={chat.title} onClose={onClose} busy={busy} embedded={embedded}>
        {context && <div className="deal-chat-context"><a href={`/buy-requests/${context.requestId}`}>{context.title}</a><span>{amount(context.price, context.currency)} / {unitLabel(context.unit)} · до {context.quantity} {unitLabel(context.unit)}</span></div>}
        <div className="deal-chat-history" aria-live="polite">{!timeline.length && <p>Ще немає повідомлень. Можете уточнити деталі пропозиції.</p>}{timeline.map(entry => entry.entryType === 'message' ? entry.kind === 'system' ? <article key={entry.id} className="deal-system-event"><p>{entry.body}</p></article> : <article key={entry.id} className={`chat-message ${entry.senderId === viewer ? 'chat-message-mine' : 'chat-message-theirs'}`}><span className="chat-message-avatar" aria-hidden="true">{entry.senderAvatarUrl ? <img src={entry.senderAvatarUrl} alt="" /> : entry.senderUsername?.[0]?.toUpperCase() ?? '?'}</span><div className="chat-message-bubble"><p>{entry.body}</p><small>{new Date(entry.createdAt).toLocaleTimeString('uk-UA',{hour:'2-digit',minute:'2-digit'})}</small></div></article> : <article key={entry.id} className="negotiation-card"><strong>{entry.createdBy === viewer ? 'Ви запропонували' : 'Інша сторона пропонує'}</strong><p>{amount(entry.price, context?.currency ?? '')} / {unitLabel(context?.unit ?? '')} · {entry.quantity} {unitLabel(context?.unit ?? '')}</p><p>Разом: {amount(entry.price * entry.quantity + entry.deliveryPrice, context?.currency ?? '')}</p><p>{entry.delivery}{entry.deliveryPrice > 0 ? ` · ${amount(entry.deliveryPrice, context?.currency ?? '')}` : ''}</p><p>{entry.comment}</p><b>{entry.id !== latest?.id ? 'Неактуально' : ({ pending: 'Актуальна пропозиція — очікуємо відповіді', accepted: 'Умови погоджено. Угода ще не створена.', rejected: 'Відхилено', withdrawn: 'Відкликано', expired: 'Строк дії минув', countered: 'Неактуально' } as Record<string,string>)[entry.status]}</b>{entry.status === 'pending' && entry.id === latest?.id && viewer && <div className="deal-actions">{entry.createdBy !== viewer ? <><button className="primary-button" disabled={busy} onClick={() => negotiate('accept', entry)}>Прийняти умови</button><button className="outline-button" disabled={busy} onClick={editTerms}>Запропонувати інші умови</button><button className="text-button" disabled={busy} onClick={() => negotiate('reject', entry)}>Відхилити</button></> : <button className="text-button" disabled={busy} onClick={() => negotiate('withdraw', entry)}>Відкликати умови</button>}</div>}</article>)}</div>
        {!messages.some(m => m.kind === 'text') && <div className="deal-quick-replies">{['Чи актуальна пропозиція?','Чи можете зробити дешевше?','Коли можна отримати?','Чи є доставка?','Хочу уточнити щодо товару'].map(value => <button key={value} className="outline-button compact" onClick={() => setText(value)}>{value}</button>)}</div>}
        {error && <p role="alert" className="form-error">{error}</p>}
        <form className="chat-input" onSubmit={e => { e.preventDefault(); if (text.trim()) void act(`/api/conversations/${chat.conversationId}/messages`, { body: text.trim() }, () => setText('')) }}><input aria-label="Повідомлення" placeholder="Повідомлення…" value={text} maxLength={5000} onChange={e => setText(e.target.value)} /><button className="primary-button" disabled={busy || !text.trim()}>Надіслати</button></form>
        {context?.available && <div className="deal-actions"><button className="text-button" disabled={busy} onClick={() => editing ? setEditing(false) : editTerms()}>Запропонувати інші умови</button>{context.buyerId === viewer && context.remaining > 0 && <button className="primary-button" onClick={() => setSelecting(true)}>Обрати пропозицію</button>}</div>}
        {context && viewer && <details><summary>Інші дії з користувачем</summary><ParticipantActions id={context.buyerId === viewer ? context.sellerId : context.buyerId} http={http} notify={notify} /></details>}
        {editing && context && <form className="offer-form" onSubmit={e => { e.preventDefault(); const data = Object.fromEntries(new FormData(e.currentTarget)); void act(`/api/conversations/${chat.conversationId}/negotiations`, { action: 'propose', parentId: editingParent.current, price: Number(data.price), quantity: Number(data.quantity), delivery: data.delivery, deliveryPrice: Number(data.deliveryPrice), comment: data.comment }, () => setEditing(false)) }}>
            <h3>Запропонувати інші умови</h3><div className="field-row"><label>Ціна за {unitLabel(context.unit)}<input name="price" type="number" min="0" step=".01" defaultValue={latest?.price ?? context.price} required /></label><label>Кількість ({unitLabel(context.unit)})<input name="quantity" type="number" min=".001" step=".001" max={Math.min(context.quantity, context.remaining)} defaultValue={latest?.quantity ?? Math.min(context.quantity, context.remaining)} required /></label></div><label>Отримання<input name="delivery" defaultValue={latest?.delivery ?? context.delivery} maxLength={160} required /></label><label>Вартість доставки<input name="deliveryPrice" type="number" min="0" step=".01" defaultValue={latest?.deliveryPrice ?? context.deliveryPrice ?? 0} required /></label><label>Коментар<textarea name="comment" maxLength={1000} /></label><div className="deal-actions"><button className="outline-button" type="button" onClick={() => setEditing(false)}>Скасувати</button><button className="primary-button" disabled={busy}>Надіслати умови</button></div>
        </form>}
        {selecting && context && <SelectOfferDialog http={http} item={{ id: context.requestId, title: context.title, quantity: context.remaining, remainingQuantity: context.remaining, completedQuantity: 0, selectedQuantity: 0, unit: context.unit, fulfillmentMode: context.fulfillmentMode, status: 'open' }} offer={{ id: context.offerId, buyRequestId: context.requestId, seller: { id: context.sellerId, username: chat.title }, quantity: context.quantity, acceptedQuantity: 0, unit: context.unit, price: { amount: context.price, currency: context.currency }, delivery: context.delivery, deliverySnapshot: {price: context.deliveryPrice}, note: '', status: 'submitted' }} onClose={() => setSelecting(false)} onDone={() => { setSelecting(false); notify('Пропозицію обрано. Очікуємо продавця.'); void load() }} />}
    </DealDialog>
}

export function dealStatusText(order: any, viewerId: string): string {
    const buyer = order.buyer.id === viewerId
    const labels: Record<string,string> = { selected: buyer ? 'Ви обрали пропозицію. Очікуємо підтвердження продавця.' : 'Покупець обрав вашу пропозицію. Підтвердьте домовленість.', in_progress: 'Ви домовилися. Узгодьте передачу товару, а після отримання підтвердьте результат.', buyer_marked_completed: buyer ? 'Ви підтвердили результат. Очікуємо продавця.' : 'Покупець підтвердив результат. Перевірте та підтвердьте його.', seller_marked_completed: buyer ? 'Продавець підтвердив результат. Перевірте та підтвердьте його.' : 'Ви підтвердили результат. Очікуємо покупця.', completed: 'Угоду завершено. Можна залишити відгук.', disputed: 'Сторони по-різному вказали результат угоди.', cancelled: 'Домовленість скасовано.', failed: 'Угода не відбулася.', rejected: 'Продавець відмовився від домовленості.', accepted: 'Домовленість прийнято. Продавець може розпочати виконання.', expired: 'Строк домовленості минув.' }
    return labels[order.status] ?? 'Домовленість очікує подальших дій.'
}

export const failureReasons: Record<string,string> = { SELLER_NOT_AVAILABLE: 'Продавець недоступний', SELLER_CANCELLED: 'Продавець відмовився', BUYER_CANCELLED: 'Покупець відмовився', PRODUCT_UNAVAILABLE: 'Товар уже недоступний', PRICE_CHANGED: 'Ціна змінилася', CONDITIONS_CHANGED: 'Умови змінилися', DELIVERY_PROBLEM: 'Не домовилися про доставку', SELLER_NOT_RESPONDING: 'Продавець не відповідає', BUYER_NOT_RESPONDING: 'Покупець не відповідає', PRODUCT_NOT_AS_EXPECTED: 'Товар не відповідав очікуванням', FOUND_ANOTHER_OPTION: 'Домовився з іншим продавцем', OTHER: 'Інше' }

export function OrderResultDialog({ order, viewerId, mode, http, onClose, onDone }: { order: any; viewerId: string; mode: 'complete' | 'fail' | 'cancel'; http: Http; onClose: () => void; onDone: () => void }) {
    const other = order.buyer.id === viewerId ? order.sellerResult : order.buyerResult
    const [choice, setChoice] = useState('same')
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const sending = useRef(false)
    const submit = async (event: FormEvent<HTMLFormElement>) => {
        event.preventDefault(); if (sending.current) return; sending.current = true; setBusy(true); setError('')
        const data = Object.fromEntries(new FormData(event.currentTarget))
        const failed = mode === 'fail' || choice === 'failed'
        const path = mode === 'cancel' ? 'status' : failed ? 'fail' : 'complete'
        const body = mode === 'cancel' ? { status: 'cancelled', reason: `${failureReasons[String(data.reason)]}${data.comment ? ': ' + data.comment : ''}` } : failed ? { reason: data.reason, comment: data.comment } : { actualQuantity: choice === 'same' ? other?.quantity ?? order.quantity : Number(data.quantity), actualTotal: choice === 'same' ? other?.total ?? order.subtotal : data.total === '' ? undefined : Number(data.total), comment: data.comment }
        try { await http(`/api/orders/${order.id}/${path}`, { method: mode === 'cancel' ? 'PATCH' : 'POST', body: JSON.stringify(body) }); onDone() } catch (caught) { setError((caught as Error).message) } finally { sending.current = false; setBusy(false) }
    }
    return <DealDialog title={mode === 'complete' ? 'Підтвердити результат угоди' : mode === 'cancel' ? 'Скасувати домовленість?' : 'Угода не відбулася'} onClose={onClose} busy={busy}><form onSubmit={submit}>
        <p>Домовлялися: {order.quantity} {unitLabel(order.unit)} · {amount(order.subtotal, order.price.currency)}</p>
        {other?.outcome === 'completed' && <p>Інша сторона вказала: <b>{other.quantity} {unitLabel(order.unit)} · {amount(other.total, order.price.currency)}</b></p>}
        {mode === 'complete' && <label>Як пройшла угода?<select value={choice} onChange={e => setChoice(e.target.value)}><option value="same">{other ? 'Так, підтверджую вказаний результат' : 'Усе як домовлялися'}</option><option value="changed">Умови трохи змінилися</option><option value="partial">Отримано лише частину</option><option value="failed">Угода не відбулася</option></select></label>}
        {mode === 'complete' && ['changed','partial'].includes(choice) && <><label>Фактична кількість ({unitLabel(order.unit)})<input name="quantity" type="number" min=".001" max={order.quantity} step=".001" defaultValue={other?.quantity ?? order.quantity} required /></label><label>Фактична сума (необов’язково)<input name="total" type="number" min="0" step=".01" placeholder={String(order.subtotal)} /></label></>}
        {(mode !== 'complete' || choice === 'failed') && <><label>Причина<select name="reason" required>{Object.entries(failureReasons).map(([key,label]) => <option value={key} key={key}>{label}</option>)}</select></label><p className="form-hint">Після скасування кількість знову буде доступна для інших пропозицій. Якщо друга сторона вже підтвердила отримання, обидві відповіді буде збережено для узгодження.</p></>}
        <label>Коментар<textarea name="comment" maxLength={800} /></label>{error && <p role="alert" className="form-error">{error}</p>}
        <div className="deal-actions"><button className="outline-button" type="button" disabled={busy} onClick={onClose}>Назад</button><button className="primary-button" disabled={busy}>{busy ? 'Зберігаємо…' : mode === 'cancel' ? 'Так, скасувати' : 'Підтвердити'}</button></div>
    </form></DealDialog>
}
