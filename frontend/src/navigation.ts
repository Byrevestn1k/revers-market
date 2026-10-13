export type AppView = 'home' | 'find' | 'products' | 'map' | 'mine' | 'create' | 'request' | 'requests' | 'market' | 'orders' | 'messages' | 'notifications' | 'profile' | 'subscriptions' | 'favorites' | 'cabinet'

export const viewRoutes: Record<AppView, string> = {
    home: '/dashboard',
    find: '/discover',
    products: '/products',
    map: '/map',
    mine: '/my/products',
    create: '/my/products/new',
    request: '/my/requests/new',
    requests: '/my/requests',
    market: '/requests',
    orders: '/orders',
    messages: '/messages',
    notifications: '/notifications',
    profile: '/settings/profile',
    subscriptions: '/settings/demand-subscriptions',
    favorites: '/favorites',
    cabinet: '/cabinet',
}

export const productEditPath = (id: string) => `/my/products/${encodeURIComponent(id)}/edit`

const routeViews = new Map(Object.entries(viewRoutes).map(([view, route]) => [route, view as AppView]))

export function viewForPath(pathname: string): AppView | null {
    if (/^\/messages\/[^/]+$/.test(pathname)) return 'messages'
    if (/^\/my\/products\/[^/]+\/edit$/.test(pathname)) return 'create'
    return routeViews.get(pathname) ?? null
}

export type MobileTab = 'find' | 'favorites' | 'add' | 'messages' | 'cabinet'

export function mobileTabForPath(pathname: string): MobileTab {
    if (pathname === '/favorites') return 'favorites'
    if (pathname === '/my/products/new' || pathname === '/my/requests/new') return 'add'
    if (pathname === '/messages' || /^\/messages\/[^/]+$/.test(pathname)) return 'messages'
    if (pathname === '/discover' || pathname === '/products' || /^\/products\/[^/]+$/.test(pathname) || pathname === '/requests' || pathname === '/buy-requests' || /^\/buy-requests\/[^/]+$/.test(pathname) || pathname === '/map' || /^\/profiles\/[^/]+$/.test(pathname)) return 'find'
    return 'cabinet'
}

export function productEditIdForPath(pathname: string): string | null {
    const match = pathname.match(/^\/my\/products\/([^/]+)\/edit$/)
    if (!match) return null
    try { return decodeURIComponent(match[1]) } catch { return null }
}

export function conversationIdForPath(pathname: string): string | null {
    const match = pathname.match(/^\/messages\/([^/]+)$/)
    if (!match) return null
    try { return decodeURIComponent(match[1]) } catch { return null }
}

export function legacyDestination(search: string): string | null {
    const params = new URLSearchParams(search)
    const legacyView = params.get('view') as AppView | null
    if (!legacyView || !viewRoutes[legacyView]) return null
    if (legacyView === 'messages' && params.get('conversation')) return `/messages/${encodeURIComponent(params.get('conversation')!)}`
    const destination = new URL(viewRoutes[legacyView], 'http://local')
    if (legacyView === 'messages' && params.get('filter')) destination.searchParams.set('filter', params.get('filter')!)
    return destination.pathname + destination.search
}
