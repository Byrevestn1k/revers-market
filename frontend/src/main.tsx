import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname);
const Entry = isAdmin ? lazy(() => import('./admin/AdminApp')) : lazy(() => import('./public-entry'));
if ('serviceWorker' in navigator && window.isSecureContext) {
  window.addEventListener('load', () => { void navigator.serviceWorker.register('/sw.js').catch(() => undefined); });
}
createRoot(document.getElementById('root')!).render(
  <StrictMode><Suspense fallback={<p>Завантаження…</p>}><Entry /></Suspense></StrictMode>,
);
