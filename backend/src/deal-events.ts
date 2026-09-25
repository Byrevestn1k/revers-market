import type { PoolClient } from 'pg'
import { audit, createNotification } from './community-service.js'

// Every operation locks request -> offer -> order, including selections.
export const lockDeal = async (client: PoolClient, orderId: string) => {
    const found = (await client.query('SELECT buy_request_id, offer_id FROM orders WHERE id = $1', [orderId])).rows[0]
    if (!found) return null
    await client.query('SELECT id FROM buy_requests WHERE id = $1 FOR UPDATE', [found.buy_request_id])
    if (found.offer_id) await client.query('SELECT id FROM offers WHERE id = $1 FOR UPDATE', [found.offer_id])
    return (await client.query('SELECT * FROM orders WHERE id = $1 FOR UPDATE', [orderId])).rows[0]
}

export const dealEvent = async (client: PoolClient, order: any, actorId: string, action: string, title: string, body: string) => {
    const conversation = (await client.query('SELECT id FROM conversations WHERE offer_id = $1 OR order_id = $2 LIMIT 1', [order.offer_id, order.id])).rows[0]
    if (conversation) {
        await client.query("INSERT INTO messages (conversation_id, sender_id, body, kind) VALUES ($1,$2,$3,'system')", [conversation.id, actorId, `${title}. ${body}`])
        await client.query('UPDATE conversations SET updated_at = now() WHERE id = $1', [conversation.id])
    }
    await audit(client, actorId, action, 'order', order.id, { requestId: order.buy_request_id, offerId: order.offer_id })
    await createNotification(client, actorId === order.buyer_id ? order.seller_id : order.buyer_id, 'order', title, body, order.id, conversation?.id ?? null)
}
