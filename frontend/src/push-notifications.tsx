import { useEffect, useRef, useState } from 'react'
import './push-notifications.css'

const api = import.meta.env.VITE_API_URL ?? ''
const ownerKey = 'deshchotreba.push.owner'
const dismissedKey = 'deshchotreba.push.dismissed.'

async function call(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(api + path, { method, credentials: 'include', headers: { 'Content-Type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) })
    if (!response.ok) throw new Error('Не вдалося змінити налаштування сповіщень. Спробуйте ще раз.')
    return response.status === 204 ? null : response.json()
}

function supported() {
    return window.isSecureContext && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
}

async function registration(): Promise<ServiceWorkerRegistration> {
    const existing = await navigator.serviceWorker.getRegistration('/')
    return existing ?? navigator.serviceWorker.register('/sw.js')
}

async function closePushNotifications(worker: ServiceWorkerRegistration) {
    if (typeof worker.getNotifications !== 'function') return
    const notifications = await worker.getNotifications()
    for (const notification of notifications) notification.close()
}

function read(key: string) { try { return localStorage.getItem(key) } catch { return null } }
function write(key: string, value: string) { try { localStorage.setItem(key, value) } catch { /* unavailable storage */ } }
function remove(key: string) { try { localStorage.removeItem(key) } catch { /* unavailable storage */ } }

/** Revoke before logging out so a subscription cannot follow another account. */
export async function disconnectPush() {
    if (!supported()) return
    const worker = await registration()
    await closePushNotifications(worker)
    const subscription = await worker.pushManager.getSubscription()
    if (!subscription) { remove(ownerKey); return }
    await call('/api/push/subscriptions', 'DELETE', { subscription: subscription.toJSON() })
    await subscription.unsubscribe()
    remove(ownerKey)
}

export async function unsubscribeLocalPush() {
    if (!supported()) return
    const worker = await registration()
    await closePushNotifications(worker)
    const subscription = await worker.pushManager.getSubscription()
    if (subscription) await subscription.unsubscribe()
    remove(ownerKey)
}

/** An account changed in another tab: revoke using proof of subscription ownership. */
let reconciliation: Promise<void> = Promise.resolve()
export function reconcilePushOwner(userId: string) {
    const next = reconciliation.catch(() => undefined).then(async () => {
        if (!supported()) return
        const subscription = await (await registration()).pushManager.getSubscription()
        if (!subscription) { remove(ownerKey); return }
        if (read(ownerKey) !== userId) await disconnectPush()
    })
    reconciliation = next
    return next
}

function applicationKey(value: string): Uint8Array<ArrayBuffer> {
    const encoded = value.replace(/-/g, '+').replace(/_/g, '/')
    const raw = atob(encoded + '='.repeat((4 - encoded.length % 4) % 4))
    return Uint8Array.from(raw, char => char.charCodeAt(0))
}

export function PushSettings({ userId, compact = false }: { userId: string; compact?: boolean }) {
    const [available, setAvailable] = useState(false)
    const [enabled, setEnabled] = useState(false)
    const [busy, setBusy] = useState(false)
    const [error, setError] = useState('')
    const [dismissed, setDismissed] = useState(() => read(dismissedKey + userId) === 'yes')
    const [publicKey, setPublicKey] = useState('')
    const statusVersion = useRef(0)

    async function refreshStatus() {
        const version = ++statusVersion.current
        const worker = await registration()
        const current = await worker.pushManager.getSubscription()
        let subscribed = false
        if (current && read(ownerKey) === userId) {
            const status = await call('/api/push/status', 'POST', { endpoint: current.endpoint }) as { active: boolean }
            subscribed = status.active === true
            if (!subscribed) await closePushNotifications(worker)
        }
        if (version === statusVersion.current) { setEnabled(subscribed); setError('') }
    }

    useEffect(() => {
        let active = true
        if (!supported()) return
        void (async () => {
            try {
                const config = await call('/api/push/config') as { enabled: boolean; publicKey: string | null }
                if (!config.enabled || !config.publicKey) return
                await reconcilePushOwner(userId)
                await refreshStatus()
                if (active) { setPublicKey(config.publicKey); setAvailable(true) }
            } catch { if (active) setError('Сповіщення зараз недоступні. Спробуйте пізніше.') }
        })()
        return () => { active = false }
    }, [userId])

    async function enable() {
        setBusy(true); setError('')
        try {
            // This call is deliberately made only in response to the button.
            const permission = await Notification.requestPermission()
            if (permission !== 'granted') { setError('Дозвіл не надано. Внутрішні сповіщення залишаються доступними.'); return }
            const session = await call('/api/auth/me') as { user: { id: string } | null }
            if (session.user?.id !== userId) throw new Error('Акаунт змінився')
            const worker = await registration()
            const existing = await worker.pushManager.getSubscription()
            const subscription = existing ?? await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: applicationKey(publicKey) })
            try { await call('/api/push/subscriptions', 'POST', { expectedUserId: userId, subscription: subscription.toJSON() }) }
            catch (caught) { if (!existing) await subscription.unsubscribe(); throw caught }
            ++statusVersion.current
            write(ownerKey, userId); setEnabled(true); setDismissed(false)
            window.dispatchEvent(new Event('push-settings-changed'))
        } catch { setError('Не вдалося увімкнути сповіщення. Спробуйте ще раз.') }
        finally { setBusy(false) }
    }

    async function disable() {
        setBusy(true); setError('')
        try { await disconnectPush(); ++statusVersion.current; setEnabled(false); window.dispatchEvent(new Event('push-settings-changed')) }
        catch { setError('Не вдалося вимкнути сповіщення. Перевірте з’єднання та спробуйте ще раз.') }
        finally { setBusy(false) }
    }

    useEffect(() => {
        const refresh = () => { if (supported()) void refreshStatus().catch(() => { setEnabled(false); setError('Не вдалося перевірити стан сповіщень. Спробуйте пізніше.') }) }
        window.addEventListener('storage', refresh)
        window.addEventListener('focus', refresh)
        window.addEventListener('push-settings-changed', refresh)
        return () => { statusVersion.current++; window.removeEventListener('storage', refresh); window.removeEventListener('focus', refresh); window.removeEventListener('push-settings-changed', refresh) }
    }, [userId])

    if (compact && (!available || enabled || dismissed)) return null
    if (!available && !error) return compact ? null : <section className="push-settings"><h2>Сповіщення на пристрої</h2><p>Сповіщення на цьому пристрої зараз недоступні. Внутрішні сповіщення залишаються доступними.</p></section>
    return <section className="push-settings" aria-label="Сповіщення на пристрої">
        <h2>{compact ? 'Хочете отримувати сповіщення?' : 'Сповіщення на пристрої'}</h2>
        <p>{enabled ? 'Сповіщення на цьому пристрої увімкнені.' : 'Отримуйте сповіщення, коли продавець відповість на ваш запит або хтось напише вам повідомлення.'}</p>
        {error && <p role="status">{error}</p>}
        {available && <div className="push-settings-actions">{enabled ? <button type="button" className="outline-button compact" onClick={() => void disable()} disabled={busy}>Вимкнути сповіщення</button> : <button type="button" className="primary-button compact" onClick={() => void enable()} disabled={busy}>Увімкнути сповіщення</button>}{compact && <button type="button" className="outline-button compact" onClick={() => { write(dismissedKey + userId, 'yes'); setDismissed(true) }}>Не зараз</button>}</div>}
    </section>
}
