import { isDeepStrictEqual } from 'node:util'
import { createHash } from 'node:crypto'
import type { AuthUser } from './auth.js'
import { pool } from './db/client.js'
import { audit, createNotification, usersAreBlocked } from './community-service.js'

const uuid = (value: unknown): value is string => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value)
const messages: Record<string, string> = {
    TERMS_CHANGED: 'Умови товару змінилися. Оновіть сторінку та перевірте пропозицію ще раз.',
    NEGOTIATION_CHANGED: 'Ця версія пропозиції вже неактуальна. Перегляньте останні умови.',
    PRODUCT_STOCK_UNAVAILABLE: 'Товар недоступний або потрібної кількості вже немає.',
    INVALID_NEGOTIATION_TERMS: 'Перевірте ціну, кількість і спосіб отримання.',
}
const error = (status: number, code: string) => ({ status, body: { error: code, ...(messages[code] ? { message: messages[code] } : {}) } })
const remaining = (p: any) => (Math.round(Number(p.quantity) * 1000) - Math.round(Number(p.reserved_quantity) * 1000)) / 1000
const visibleDelivery = (p: any) => p.delivery_options ?? (p.delivery_mode === 'pickup' ? [{ method: 'SELF_PICKUP' }] : p.delivery_mode === 'seller_delivery' ? [{ method: 'SELLER_DELIVERY' }] : p.delivery_mode === 'flexible' ? [{ method: 'FLEXIBLE' }] : [])
const dto = (row: any) => ({ id: row.id, createdBy: row.created_by, parentId: row.parent_id, price: Number(row.unit_price), currency: row.product_terms.currency, unit: row.product_terms.unit, quantity: Number(row.quantity), delivery: row.delivery, postalOperator: row.postal_operator, deliveryPrice: Number(row.delivery_price), comment: row.comment, status: row.status, createdAt: row.created_at, orderId: row.order_id })
const terms = (p: any) => ({ title: p.title, description: p.description, price: Number(p.price), currency: p.currency, unit: p.unit, deliveryOptions: p.delivery_options, deliveryMode: p.delivery_mode })
const token = (value: any) => createHash('sha256').update(JSON.stringify([value.title, value.description, value.price, value.currency, value.unit, value.deliveryOptions, value.deliveryMode])).digest('hex')
const available = (p: any) => p.status === 'active' && (!p.expires_at || p.expires_at > new Date()) && Number(p.quantity) > Number(p.reserved_quantity)
const supports = (p: any, method: unknown, operator: unknown) => {
    if (typeof method !== 'string' || !['SELF_PICKUP', 'SELLER_DELIVERY', 'POSTAL_DELIVERY'].includes(method)) return false
    const option = Array.isArray(p.delivery_options) ? p.delivery_options.find((o: any) => o.method === method) : null
    if (!option) return method !== 'POSTAL_DELIVERY' && operator == null && (Array.isArray(p.delivery_options) ? p.delivery_options.some((o: any) => o.method === 'FLEXIBLE') : (p.delivery_mode === 'flexible' || (p.delivery_mode === 'pickup' && method === 'SELF_PICKUP') || (p.delivery_mode === 'seller_delivery' && method === 'SELLER_DELIVERY')))
    return method === 'POSTAL_DELIVERY' ? typeof operator === 'string' && ['NOVA_POSHTA', 'UKRPOSHTA'].includes(operator) && Array.isArray(option.postalOperators) && option.postalOperators.includes(operator) : operator == null
}

export const getDirectProposals = async (user: AuthUser, conversationId: string) => {
    if (!uuid(conversationId)) return error(400, 'INVALID_CONVERSATION_ID')
    const row = (await pool.query(`SELECT p.*, buyer.user_id AS buyer_id, seller.user_id AS seller_id FROM conversations c
        JOIN conversation_participants me ON me.conversation_id=c.id AND me.user_id=$2 AND me.deleted_at IS NULL
        JOIN conversation_participants buyer ON buyer.conversation_id=c.id AND buyer.role='buyer'
        JOIN conversation_participants seller ON seller.conversation_id=c.id AND seller.role='seller'
        JOIN products p ON p.id=c.product_id AND p.owner_id=seller.user_id WHERE c.id=$1`, [conversationId, user.id])).rows[0]
    if (!row) return error(404, 'CONVERSATION_NOT_FOUND')
    const proposals = (await pool.query('SELECT * FROM direct_product_proposals WHERE conversation_id=$1 ORDER BY created_at,id', [conversationId])).rows
    const deliveryOptions = visibleDelivery(row)
    return { status: 200, body: { context: { productId: row.id, title: row.title, buyerId: row.buyer_id, sellerId: row.seller_id, unit: row.unit, currency: row.currency, price: Number(row.price), remaining: remaining(row), deliveryOptions, termsToken: token(terms(row)), available: available(row) }, proposals: proposals.map(dto) } }
}

export const changeDirectProposal = async (user: AuthUser, conversationId: string, input: Record<string, unknown>) => {
    const action = input.action
    if (typeof action !== 'string' || !['propose', 'accept', 'reject', 'withdraw'].includes(action) || !uuid(conversationId)) return error(400, 'INVALID_ACTION')
    if (action === 'propose' && (!uuid(input.requestKey) || (input.parentId !== null && !uuid(input.parentId)))) return error(400, 'INVALID_VERSION')
    if (action !== 'propose' && !uuid(input.proposalId)) return error(400, 'INVALID_VERSION')
    const client = await pool.connect()
    try {
        await client.query('BEGIN')
        if (action === 'propose') await client.query('SELECT pg_advisory_xact_lock(hashtext($1), hashtext($2))', [user.id, input.requestKey])
        const link = (await client.query(`SELECT c.product_id, buyer.user_id AS buyer_id, seller.user_id AS seller_id FROM conversations c
            JOIN conversation_participants me ON me.conversation_id=c.id AND me.user_id=$2 AND me.deleted_at IS NULL
            JOIN conversation_participants buyer ON buyer.conversation_id=c.id AND buyer.role='buyer'
            JOIN conversation_participants seller ON seller.conversation_id=c.id AND seller.role='seller'
            WHERE c.id=$1 AND c.product_id IS NOT NULL`, [conversationId, user.id])).rows[0]
        if (!link) { await client.query('ROLLBACK'); return error(404, 'CONVERSATION_NOT_FOUND') }
        const p = (await client.query('SELECT * FROM products WHERE id=$1 FOR UPDATE', [link.product_id])).rows[0]
        const participants = await client.query('SELECT user_id, deleted_at FROM conversation_participants WHERE conversation_id=$1 ORDER BY user_id FOR UPDATE', [conversationId])
        if (!participants.rows.some(participant => participant.user_id === user.id && !participant.deleted_at)) { await client.query('ROLLBACK'); return error(404, 'CONVERSATION_NOT_FOUND') }
        await client.query('SELECT id FROM conversations WHERE id=$1 FOR UPDATE', [conversationId])
        if (!p || p.owner_id !== link.seller_id || await usersAreBlocked(client, link.buyer_id, link.seller_id)) { await client.query('ROLLBACK'); return error(403, 'USER_BLOCKED') }
        if (action === 'propose') {
            const retry = (await client.query('SELECT * FROM direct_product_proposals WHERE created_by=$1 AND request_key=$2', [user.id, input.requestKey])).rows[0]
            if (retry) {
                const same = retry.conversation_id === conversationId && retry.parent_id === input.parentId && Number(retry.unit_price) === input.price && Number(retry.quantity) === input.quantity && retry.delivery === input.delivery && retry.postal_operator === (input.postalOperator ?? null) && Number(retry.delivery_price) === input.deliveryPrice && retry.comment === (input.comment ?? '') && retry.product_terms.currency === input.expectedCurrency && retry.product_terms.unit === input.expectedUnit && retry.product_terms.price === input.expectedProductPrice && token(retry.product_terms) === input.expectedTermsToken && isDeepStrictEqual(visibleDelivery({ delivery_options: retry.product_terms.deliveryOptions, delivery_mode: retry.product_terms.deliveryMode }), input.expectedDeliveryOptions)
                await client.query('COMMIT')
                return same ? { status: 200, body: { proposal: dto(retry), orderId: retry.order_id } } : error(409, 'REQUEST_KEY_REUSED')
            }
        }
        const latest = (await client.query('SELECT * FROM direct_product_proposals WHERE conversation_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1', [conversationId])).rows[0]
        if (action === 'accept') {
            const accepted = (await client.query("SELECT * FROM direct_product_proposals WHERE id=$1 AND conversation_id=$2 AND status='accepted' AND order_id IS NOT NULL", [input.proposalId, conversationId])).rows[0]
            if (accepted && accepted.created_by !== user.id) { await client.query('COMMIT'); return { status: 200, body: { proposal: dto(accepted), orderId: accepted.order_id } } }
        }
        if ((action === 'propose' || action === 'accept') && !available(p)) { await client.query('ROLLBACK'); return error(409, 'PRODUCT_STOCK_UNAVAILABLE') }
        let proposal: any
        let orderId: string | null = null
        if (action === 'propose') {
            if ((latest?.id ?? null) !== input.parentId || (latest?.status === 'pending' && latest.created_by === user.id)) { await client.query('ROLLBACK'); return error(409, 'NEGOTIATION_CHANGED') }
            if ((!latest || latest.status !== 'pending') && user.id !== link.buyer_id) { await client.query('ROLLBACK'); return error(403, 'FORBIDDEN') }
            if (input.expectedCurrency !== p.currency || input.expectedUnit !== p.unit || input.expectedProductPrice !== Number(p.price) || input.expectedTermsToken !== token(terms(p)) || !isDeepStrictEqual(input.expectedDeliveryOptions, visibleDelivery(p))) { await client.query('ROLLBACK'); return error(409, 'TERMS_CHANGED') }
            if (typeof input.price !== 'number' || !Number.isFinite(input.price) || input.price < 0 || input.price > 1e12 || Number(input.price.toFixed(4)) !== input.price || typeof input.quantity !== 'number' || !Number.isFinite(input.quantity) || input.quantity < 0.001 || input.quantity > remaining(p) || Number(input.quantity.toFixed(3)) !== input.quantity || typeof input.deliveryPrice !== 'number' || !Number.isFinite(input.deliveryPrice) || input.deliveryPrice < 0 || input.deliveryPrice > 1e12 || Number(input.deliveryPrice.toFixed(4)) !== input.deliveryPrice || input.price * input.quantity + input.deliveryPrice > 1e12 || !supports(p, input.delivery, input.postalOperator) || (input.comment !== undefined && (typeof input.comment !== 'string' || input.comment.length > 1000))) { await client.query('ROLLBACK'); return error(400, 'INVALID_NEGOTIATION_TERMS') }
            await client.query("UPDATE direct_product_proposals SET status='countered', responded_at=now() WHERE conversation_id=$1 AND status='pending'", [conversationId])
            proposal = (await client.query(`INSERT INTO direct_product_proposals (conversation_id,product_id,created_by,request_key,parent_id,unit_price,quantity,delivery,postal_operator,delivery_price,comment,product_terms)
                VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`, [conversationId, p.id, user.id, input.requestKey, input.parentId, input.price, input.quantity, input.delivery, input.postalOperator ?? null, input.deliveryPrice, input.comment ?? '', JSON.stringify(terms(p))])).rows[0]
        } else {
            if (!latest || latest.id !== input.proposalId || latest.status !== 'pending') { await client.query('ROLLBACK'); return error(409, 'NEGOTIATION_CHANGED') }
            if ((action === 'withdraw') !== (latest.created_by === user.id)) { await client.query('ROLLBACK'); return error(403, 'FORBIDDEN') }
            if (action === 'accept') {
                if (!isDeepStrictEqual(terms(p), latest.product_terms) || !supports(p, latest.delivery, latest.postal_operator)) { await client.query('ROLLBACK'); return error(409, 'TERMS_CHANGED') }
                if (Number(latest.quantity) > remaining(p)) { await client.query('ROLLBACK'); return error(409, 'PRODUCT_STOCK_UNAVAILABLE') }
                await client.query('UPDATE products SET reserved_quantity=reserved_quantity+$2, updated_at=now() WHERE id=$1', [p.id, latest.quantity])
                const photos = (await client.query('SELECT url, alt FROM product_photos WHERE product_id=$1 ORDER BY sort_order,id', [p.id])).rows
                const delivery = { delivery: latest.delivery, postalOperator: latest.postal_operator, price: Number(latest.delivery_price) }
                const subtotal = Number(latest.unit_price) * Number(latest.quantity) + Number(latest.delivery_price)
                const snapshot = { productTitle: p.title, description: p.description, photos, delivery, goodsTotal: Number(latest.unit_price) * Number(latest.quantity), grandTotal: subtotal, directProposalId: latest.id }
                const order = (await client.query(`INSERT INTO orders (source,buyer_id,seller_id,status,currency,subtotal,quantity,unit,unit_price,conditions_snapshot,seller_confirmed_at)
                    VALUES ('direct_product',$1,$2,'in_progress',$3,$4,$5,$6,$7,$8,now()) RETURNING id`, [link.buyer_id, link.seller_id, p.currency, subtotal, latest.quantity, p.unit, latest.unit_price, JSON.stringify(snapshot)])).rows[0]
                orderId = order.id
                await client.query('INSERT INTO order_items (order_id,product_id,quantity,unit,unit_price,currency,product_title_snapshot,offer_terms_snapshot,delivery_terms_snapshot) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)', [orderId, p.id, latest.quantity, p.unit, latest.unit_price, p.currency, p.title, JSON.stringify(snapshot), JSON.stringify(delivery)])
            }
            const status = action === 'accept' ? 'accepted' : action === 'reject' ? 'rejected' : 'withdrawn'
            proposal = (await client.query('UPDATE direct_product_proposals SET status=$2, order_id=$3, responded_at=now() WHERE id=$1 RETURNING *', [latest.id, status, orderId])).rows[0]
        }
        await audit(client, user.id, `DIRECT_PROPOSAL_${String(action).toUpperCase()}`, 'product', p.id, { proposalId: proposal.id, orderId, conversationId })
        const title = action === 'accept' ? 'Угоду укладено' : action === 'reject' ? 'Пропозицію відхилено' : action === 'withdraw' ? 'Пропозицію відкликано' : latest?.status === 'pending' ? 'Запропоновано інші умови' : 'Покупець запропонував угоду'
        await client.query('UPDATE conversation_participants SET deleted_at=NULL WHERE conversation_id=$1 AND user_id<>$2 AND deleted_at IS NOT NULL', [conversationId, user.id])
        await createNotification(client, user.id === link.buyer_id ? link.seller_id : link.buyer_id, 'order', title, 'Перегляньте домовленість у чаті', user.id === link.buyer_id ? 'selling' : 'buying', { conversationId, orderId, directProposalId: proposal.id })
        await client.query("INSERT INTO messages (conversation_id,sender_id,body,kind,created_at) VALUES ($1,$2,$3,'system',clock_timestamp())", [conversationId, user.id, action === 'accept' ? 'Умови погоджено. Угоду створено.' : title])
        await client.query('UPDATE conversations SET updated_at=now() WHERE id=$1', [conversationId])
        await client.query('COMMIT')
        return { status: 200, body: { proposal: dto(proposal), orderId } }
    } catch (e) { await client.query('ROLLBACK'); throw e } finally { client.release() }
}
