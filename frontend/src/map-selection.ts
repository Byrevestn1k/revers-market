import type { SellerProductPoint } from './map-sellers'

export type MapSelection = { ownerId?: string; ids?: string[]; kind?: 'product' | 'buyRequest'; items?: SellerProductPoint[] }
export const markerKey = (item: Pick<SellerProductPoint, 'id' | 'kind'>) => `${item.kind}:${item.id}`

/** Keep the clicked group's complete membership while a zoom fetch changes the viewport. */
export function selectionMarkers(selection: MapSelection | null, current: SellerProductPoint[], visible: SellerProductPoint[]): SellerProductPoint[] {
    if (!selection) return visible
    const latest = new Map(current.map(item => [markerKey(item), item]))
    const source = selection.items?.map(item => latest.get(markerKey(item)) ?? item) ?? (selection.ownerId ? current : visible)
    const ids = new Set(selection.ids)
    return source.filter(item => (!selection.kind || item.kind === selection.kind) && (selection.ids ? ids.has(item.id) : item.owner?.id === selection.ownerId))
}

export function selectionForMarker(item: SellerProductPoint, selection: MapSelection | null): MapSelection {
    if (selection?.items?.some(candidate => markerKey(candidate) === markerKey(item))) return selection
    return { ids: [item.id], kind: item.kind, items: [item] }
}
