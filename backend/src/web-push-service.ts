import webpush from 'web-push'
import { pool } from './db/client.js'

type Subscription = { endpoint: string; keys: { p256dh: string; auth: string } }
const hosts = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'web.push.apple.com']
const encodedKey = (value: unknown, bytes: number): value is string => {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value)) return false
    try { return Buffer.from(value, 'base64url').length === bytes && Buffer.from(value, 'base64url').toString('base64url') === value } catch { return false }
}

export const validSubscription = (value: unknown): value is Subscription => {
    if (!value || typeof value !== 'object') return false
    const s = value as Subscription
    if (typeof s.endpoint !== 'string' || s.endpoint.length > 2048 || !s.keys || !encodedKey(s.keys.p256dh, 65) || !encodedKey(s.keys.auth, 16)) return false
    if (Buffer.from(s.keys.p256dh, 'base64url')[0] !== 4) return false
    try {
        const url = new URL(s.endpoint)
        return url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.hash && hosts.some(host => url.hostname === host || (host === 'web.push.apple.com' && url.hostname.endsWith('.push.apple.com')))
    } catch { return false }
}

export const pushConfig = () => {
    const publicKey = process.env.VAPID_PUBLIC_KEY ?? ''
    const privateKey = process.env.VAPID_PRIVATE_KEY ?? ''
    const subject = process.env.VAPID_SUBJECT ?? ''
    if (!encodedKey(publicKey, 65) || !encodedKey(privateKey, 32) || !/^(mailto:|https:\/\/)/.test(subject)) return null
    try { webpush.setVapidDetails(subject, publicKey, privateKey); return { publicKey } } catch { return null }
}

export const savePushSubscription = async (userId: string, sessionHash: string, input: unknown) => {
    if (!pushConfig()) return { status: 503, body: { error: 'PUSH_UNAVAILABLE' } }
    if (!validSubscription(input)) return { status: 400, body: { error: 'INVALID_SUBSCRIPTION' } }
    const s = input
    // A different session may claim an existing endpoint only by proving possession
    // of both browser-provided keys. A bare endpoint is never enough to reassign it.
    const result = await pool.query(`INSERT INTO push_subscriptions (endpoint,user_id,session_hash,p256dh,auth)
        SELECT $1,$2,s.token_hash,$4,$5 FROM user_sessions s WHERE s.token_hash=$3 AND s.user_id=$2 AND s.revoked_at IS NULL AND s.expires_at > now()
        ON CONFLICT (endpoint) DO UPDATE SET user_id=excluded.user_id, session_hash=excluded.session_hash,
            created_at=CASE WHEN push_subscriptions.session_hash=excluded.session_hash THEN push_subscriptions.created_at ELSE now() END
        WHERE push_subscriptions.p256dh=excluded.p256dh AND push_subscriptions.auth=excluded.auth
        RETURNING endpoint`, [s.endpoint,userId,sessionHash,s.keys.p256dh,s.keys.auth])
    return result.rowCount ? { status: 204 } : { status: 409, body: { error: 'SUBSCRIPTION_CONFLICT' } }
}

export const deletePushSubscription = async (userId: string, sessionHash: string, input: { endpoint?: unknown; subscription?: unknown }) => {
    if (validSubscription(input.subscription)) {
        const s = input.subscription
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND p256dh=$2 AND auth=$3', [s.endpoint,s.keys.p256dh,s.keys.auth])
    } else if (typeof input.endpoint === 'string' && input.endpoint.length <= 2048) {
        await pool.query('DELETE FROM push_subscriptions WHERE endpoint=$1 AND user_id=$2 AND session_hash=$3', [input.endpoint,userId,sessionHash])
    } else return { status: 400, body: { error: 'INVALID_SUBSCRIPTION' } }
    return { status: 204 }
}

export const pushPayload = (n: { type: string; conversation_id: string | null; buy_request_id: string | null; offer_id: string | null }) => {
    if (n.type === 'message' && n.conversation_id) return { title: 'Нове повідомлення', body: 'Відкрийте чат у ДещоТреба.', url: `/messages/${n.conversation_id}` }
    if (n.type === 'order' && n.buy_request_id && n.offer_id) return { title: 'Нова пропозиція', body: 'Продавець відповів на ваш запит.', url: `/my/requests?request=${n.buy_request_id}&offer=${n.offer_id}` }
    return null
}

// At-most-once attempts: never replay an ambiguous network failure. Notification
// Center remains the durable source of truth when the process or provider fails.
export const dispatchPushBatch = async () => {
    if (!pushConfig()) return
    const claimed = await pool.query(`UPDATE push_outbox SET claimed_at=now() WHERE notification_id IN (
        SELECT notification_id FROM push_outbox WHERE claimed_at IS NULL AND created_at > now() - interval '1 day'
        ORDER BY created_at LIMIT 25 FOR UPDATE SKIP LOCKED) RETURNING notification_id`)
    for (const item of claimed.rows) {
        const result = await pool.query(`SELECT n.*, o.created_at AS enqueued_at FROM notifications n JOIN push_outbox o ON o.notification_id=n.id WHERE n.id=$1`, [item.notification_id])
        const n = result.rows[0]
        if (!n) continue
        const payload = pushPayload(n)
        if (!payload) continue
        const subs = await pool.query('SELECT endpoint FROM push_subscriptions WHERE user_id=$1 AND created_at <= $2', [n.user_id,n.enqueued_at])
        for (const { endpoint } of subs.rows) {
            const client = await pool.connect()
            try {
                await client.query('BEGIN')
                const locked = await client.query(`SELECT p.endpoint,p.p256dh,p.auth FROM push_subscriptions p
                    JOIN user_sessions s ON s.token_hash=p.session_hash
                    WHERE p.endpoint=$1 AND p.user_id=$2 AND p.created_at <= $3 AND s.user_id=p.user_id
                    AND s.revoked_at IS NULL AND s.expires_at > now() FOR UPDATE OF p`, [endpoint,n.user_id,n.enqueued_at])
                if (locked.rowCount) {
                    const s = locked.rows[0]
                    try { await webpush.sendNotification({ endpoint:s.endpoint, keys:{p256dh:s.p256dh,auth:s.auth} }, JSON.stringify(payload), { TTL: 60, timeout: 10000 }) }
                    catch (error) { const status = (error as { statusCode?: number }).statusCode; if (status === 404 || status === 410) await client.query('DELETE FROM push_subscriptions WHERE endpoint=$1', [endpoint]) }
                }
                await client.query('COMMIT')
            } catch { await client.query('ROLLBACK') } finally { client.release() }
        }
    }
    await pool.query("DELETE FROM push_outbox WHERE created_at < now() - interval '1 day'")
}
