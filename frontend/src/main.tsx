import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './styles.css'
import './brand.css'
import './App.css'
import './external-auth.css'
import { PwaInvitation } from './pwa-install'

if ('serviceWorker' in navigator && window.isSecureContext) {
    window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined) })
}

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <PwaInvitation />
        <App />
    </StrictMode>,
)
