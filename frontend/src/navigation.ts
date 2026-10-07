export type AppView = 'home' | 'find' | 'products' | 'map' | 'mine' | 'create' | 'request' | 'requests' | 'market' | 'orders' | 'messages' | 'notifications' | 'profile' | 'subscriptions'

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
}

const routeViews = new Map(Object.entries(viewRoutes).map(([view, route]) => [route, view as AppView]))

export function viewForPath(pathname: string): AppView | null {
    if (/^\/messages\/[^/]+$/.test(pathname)) return 'messages'
    return routeViews.get(pathname) ?? null
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
