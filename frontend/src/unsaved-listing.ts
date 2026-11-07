import { useEffect } from 'react'

const warning = 'У формі є незбережені дані. Залишити сторінку та втратити їх?'
let dirty = false
let restoring = false

export function clearUnsavedListing() { dirty = false }
export function hasUnsavedListing() { return dirty }
export function restoreUnsavedListing() { dirty = true }

export function confirmListingNavigation(destination: string): boolean {
    const next = new URL(destination, window.location.href)
    if (!dirty || (next.pathname === window.location.pathname && next.search === window.location.search)) return true
    if (!window.confirm(warning)) return false
    dirty = false
    return true
}

// A same-URL history entry lets Back be cancelled before React unmounts the form.
export function useUnsavedListingGuard() {
    useEffect(() => {
        const mark = (event: Event) => {
            const target = event.target
            if (!(target instanceof Element) || !target.closest('form.product-form.listing-form') || dirty) return
            dirty = true
            window.history.pushState({ ...window.history.state, unsavedListingGuard: true }, '', window.location.href)
        }
        const click = (event: MouseEvent) => {
            if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
            const anchor = event.target instanceof Element ? event.target.closest('a[href]') as HTMLAnchorElement | null : null
            if (!anchor || anchor.target && anchor.target !== '_self' || anchor.hasAttribute('download')) return
            if (!confirmListingNavigation(anchor.href)) { event.preventDefault(); event.stopPropagation() }
        }
        const pop = (event: PopStateEvent) => {
            if (!event.isTrusted) return
            if (restoring) { restoring = false; event.stopImmediatePropagation(); return }
            if (!dirty) return
            event.stopImmediatePropagation()
            if (window.confirm(warning)) { dirty = false; window.history.back() }
            else { restoring = true; window.history.forward() }
        }
        const unload = (event: BeforeUnloadEvent) => { if (dirty) { event.preventDefault(); event.returnValue = '' } }
        document.addEventListener('input', mark, true)
        document.addEventListener('change', mark, true)
        document.addEventListener('pointerdown', mark, true)
        document.addEventListener('click', click, true)
        window.addEventListener('popstate', pop, true)
        window.addEventListener('beforeunload', unload)
        return () => { document.removeEventListener('input', mark, true); document.removeEventListener('change', mark, true); document.removeEventListener('pointerdown', mark, true); document.removeEventListener('click', click, true); window.removeEventListener('popstate', pop, true); window.removeEventListener('beforeunload', unload) }
    }, [])
}
