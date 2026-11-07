import { useEffect, useState } from 'react'
import './pwa-install.css'

type InstallPrompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }> }
let deferredPrompt: InstallPrompt | null = null
window.addEventListener('beforeinstallprompt', event => {
    event.preventDefault()
    deferredPrompt = event as InstallPrompt
})
const installed = () => window.matchMedia('(display-mode: standalone)').matches || (navigator as Navigator & { standalone?: boolean }).standalone === true
const ios = () => /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
const dismissed = () => { try { return localStorage.getItem('pwa-install-dismissed') === '1' } catch { return false } }
const remember = () => { try { localStorage.setItem('pwa-install-dismissed', '1') } catch { /* storage may be blocked */ } }

export function PwaInstallMenu() {
    const [isInstalled, setInstalled] = useState(installed)
    useEffect(() => {
        const update = () => setInstalled(installed())
        const finish = () => setInstalled(true)
        window.addEventListener('appinstalled', finish)
        const media = window.matchMedia('(display-mode: standalone)')
        media.addEventListener('change', update)
        return () => { window.removeEventListener('appinstalled', finish); media.removeEventListener('change', update) }
    }, [])
    if (isInstalled) return null
    return <button type="button" onClick={() => window.dispatchEvent(new Event('pwa:open-install'))}>Встановити застосунок <span>›</span></button>
}

export function PwaInvitation() {
    const [show, setShow] = useState(false)
    const [instructions, setInstructions] = useState(false)
    const [isInstalled, setInstalled] = useState(installed)
    const [editing, setEditing] = useState(false)
    useEffect(() => {
        const open = () => { if (!installed()) { setInstructions(false); setShow(true); window.scrollTo({ top: 0, behavior: 'smooth' }) } }
        const finish = () => { deferredPrompt = null; setInstalled(true); setShow(false) }
        const focus = () => setEditing(document.activeElement instanceof HTMLElement && document.activeElement.matches('input, textarea, select, [contenteditable="true"]'))
        const timer = window.setTimeout(() => { if (!installed() && !dismissed() && window.matchMedia('(max-width: 767px)').matches) setShow(true) }, 1200)
        window.addEventListener('pwa:open-install', open)
        window.addEventListener('appinstalled', finish)
        document.addEventListener('focusin', focus)
        document.addEventListener('focusout', focus)
        return () => { clearTimeout(timer); window.removeEventListener('pwa:open-install', open); window.removeEventListener('appinstalled', finish); document.removeEventListener('focusin', focus); document.removeEventListener('focusout', focus) }
    }, [])
    const dismiss = () => { remember(); setShow(false); setInstructions(false) }
    const install = async () => {
        if (deferredPrompt) {
            const prompt = deferredPrompt
            deferredPrompt = null
            try { await prompt.prompt(); const choice = await prompt.userChoice; if (choice.outcome === 'dismissed') dismiss(); else setShow(false) }
            catch { setInstructions(true) }
        } else setInstructions(true)
    }
    if (isInstalled || !show || editing) return null
    const supportsPush = !ios() && 'PushManager' in window && 'Notification' in window && 'serviceWorker' in navigator
    return <section className="pwa-invitation" aria-label="Встановлення застосунку">
        <img src="/brand/pwa-192.png" alt="" width="48" height="48" />
        <div className="pwa-invitation-content"><strong>Встановіть застосунок ДещоТреба</strong>
            {instructions ? ios() ? <p>У браузері натисніть «Поділитися» <span aria-hidden="true">⎋</span>, оберіть «На початковий екран» і підтвердьте додавання.</p> : <p>Відкрийте меню браузера та виберіть «Встановити застосунок» або «Додати на головний екран», якщо така дія доступна.</p> : <p>Іконка на головному екрані, швидкий доступ до товарів, запитів і чатів{supportsPush ? ', сповіщення про пропозиції та повідомлення' : ''}.</p>}
            <div className="pwa-invitation-actions">{!instructions && <button type="button" onClick={() => void install()}>Встановити застосунок</button>}<button type="button" onClick={dismiss}>{instructions ? 'Зрозуміло' : 'Не зараз'}</button></div>
        </div>
    </section>
}
