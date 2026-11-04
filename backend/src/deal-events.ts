import type { PoolClient } from 'pg'
import { audit, createNotification } from './community-service.js'

// Every operation locks request -> offer -> order, including selections.
export const lockDeal = async (client: PoolClient, orderId: string) => {
    const found = (await client.query('SELECT buy_request_id, offer_id FROM orders WHERE id = $1', [orderId])).rows[0]
    if (!found) return null
    if (found.buy_request_id) await client.query('SELECT id FROM buy_requests WHERE id = $1 FOR UPDATE', [found.buy_request_id])
    if (found.offer_id) await client.query('SELECT id FROM offers WHERE id = $1 FOR UPDATE', [found.offer_id])
    return (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0]
}

export const dealEvent = async (client: PoolClient, order: any, actorId: string, action: string, title: string, body: string) => {
    const directProposal = order.source === 'direct_product' ? (await client.query('SELECT id FROM direct_product_proposals WHERE order_id = $1', [order.id])).rows[0] : null
    const conversation = (await client.query('SELECT id FROM conversations c WHERE offer_id = $1 OR order_id = $2 OR EXISTS (SELECT 1 FROM direct_product_proposals dp WHERE dp.order_id = $2 AND dp.conversation_id = c.id) LIMIT 1', [order.offer_id, order.id])).rows[0]
    if (conversation) {
        if (order.source === 'direct_product') {
            await client.query('SELECT user_id FROM conversation_participants WHERE conversation_id=$1 ORDER BY user_id FOR UPDATE', [conversation.id])
            await client.query('UPDATE conversation_participants SET deleted_at=NULL, archived_at=NULL, pinned_at=NULL WHERE conversation_id=$1 AND user_id<>$2 AND deleted_at IS NOT NULL', [conversation.id, actorId])
        }
        await client.query("INSERT INTO messages (conversation_id, sender_id, body, kind) VALUES ($1,$2,$3,'system')", [conversation.id, actorId, `${title}. ${body}`])
        await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversation.id])
    }
    await audit(client, actorId, action, 'order', order.id, { requestId: order.buy_request_id, offerId: order.offer_id })
    await createNotification(client, actorId === order.buyer_id ? order.seller_id : order.buyer_id, 'order', title, body, actorId === order.buyer_id ? 'selling' : 'buying', { orderId: order.id, conversationId: conversation?.id ?? null, buyRequestId: order.buy_request_id, directProposalId: directProposal?.id ?? null })
}
