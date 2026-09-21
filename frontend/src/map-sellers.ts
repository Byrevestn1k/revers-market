export type SellerProductPoint = {
    id: string; title: string; kind: 'product' | 'buyRequest'; latitude: number; longitude: number
    distanceKm: number; geoZone: string; category: { id: string; name: string; imageIndex?: number }
    photoUrl?: string | null; price?: { amount: number; currency: string }
    quantity?: number; unit?: string; deliveryMode?: string
    publicAddress?: string; approximate?: boolean
    owner?: { id: string; username: string; nickname?: string | null; avatarUrl?: string | null }
}
export type MapResults = { markers: SellerProductPoint[]; loading: boolean; error: string; query: string; scope: string }
export type MapSeller = { id: string; username: string; latitude: number; longitude: number; distanceKm: number; geoZone: string; products: SellerProductPoint[] }
export function groupMapSellers(markers: SellerProductPoint[]): MapSeller[] {
    const sellers = new Map<string, MapSeller>()
    for (const marker of markers) {
        if (marker.kind !== 'product' || !marker.owner) continue
        let seller = sellers.get(marker.owner.id)
        if (!seller) { seller = { id: marker.owner.id, username: marker.owner.username, latitude: marker.latitude, longitude: marker.longitude, distanceKm: marker.distanceKm, geoZone: marker.geoZone, products: [] }; sellers.set(seller.id, seller) }
        seller.products.push(marker)
        if (marker.distanceKm < seller.distanceKm) { seller.distanceKm = marker.distanceKm; seller.latitude = marker.latitude; seller.longitude = marker.longitude }
    }
    return [...sellers.values()].sort((a, b) => a.distanceKm - b.distanceKm || a.username.localeCompare(b.username, 'uk'))
}
export function groupSellerLocations(sellers: MapSeller[]) {
    const groups = new Map<string, MapSeller[]>()
    for (const seller of sellers) {
        const key = `${seller.latitude},${seller.longitude}`
        const group = groups.get(key) ?? []; group.push(seller); groups.set(key, group)
    }
    return [...groups.values()]
}
