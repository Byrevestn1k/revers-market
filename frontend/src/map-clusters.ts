import type { SellerProductPoint } from './map-sellers'

export type MapViewport = { south: number; north: number; west: number; east: number; width: number; height: number }
export type MapStage = 'count' | 'categories' | 'photos'
export function mapStage(zoom: number, width: number, height: number): MapStage {
    if (zoom >= 17 && width >= 280 && height >= 240) return 'photos'
    if (zoom >= 14) return 'categories'
    return 'count'
}

type Pixel = { x: number; y: number }
export type MapNode = Pixel & {
    id: string
    type: 'cluster' | 'seller' | 'product' | 'request'
    preview: 'count' | 'avatar' | 'category' | 'photo'
    items: SellerProductPoint[]
    latitude: number
    longitude: number
    anchor: Pixel
    size: number
    displaced: boolean
}
type DetailOptions = {
    zoom: number; width: number; height: number
    filtered: boolean
    mode?: 'adaptive' | 'sellers' | 'products'
    // A selected seller/group opens one page of individual listings on the map.
    selectedIds?: ReadonlySet<string>
}

export function avatarInitials(owner?: SellerProductPoint['owner']) {
    const name = owner?.nickname || owner?.username || '?'
    const suffix = name.match(/\d+$/)?.[0]
    return suffix ? name[0].toLocaleUpperCase('uk-UA') + suffix.slice(-3) : name.trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toLocaleUpperCase('uk-UA')).join('')
}

/** Semantic markers first; screen layout never changes a listing's coordinates. */
export function buildMapNodes(points: SellerProductPoint[], project: (point: SellerProductPoint) => Pixel, options: DetailOptions): MapNode[] {
    const stage = mapStage(options.zoom, options.width, options.height)
    const selected = options.selectedIds ?? new Set<string>()
    const candidates: MapNode[] = []
    const makeNode = (items: SellerProductPoint[], type: MapNode['type']): MapNode => {
        const first = items[0], anchor = project(first)
        const preview = type === 'cluster' ? 'count' : type === 'seller' ? 'avatar' : 'category'
        return { id: `${type}:${first.kind}:${first.id}`, type, preview, items, latitude: first.latitude, longitude: first.longitude, anchor, ...anchor, size: preview === 'category' ? 40 : 44, displaced: false }
    }
    for (const kind of ['product', 'buyRequest'] as const) {
        const items = points.filter((point) => point.kind === kind).sort((a, b) => a.id.localeCompare(b.id))
        if (stage === 'count' && options.mode !== 'products') {
            for (const group of clusterMapProducts(items, options.zoom, project, 'count')) candidates.push(makeNode(group.products, 'cluster'))
            continue
        }
        const locations = new Map<string, SellerProductPoint[]>()
        for (const item of items) {
            const key = `${item.owner?.id ?? item.id}:${item.latitude}:${item.longitude}`
            const group = locations.get(key) ?? []
            group.push(item); locations.set(key, group)
        }
        for (const group of locations.values()) {
            const focused = group.filter((item) => selected.has(item.id))
            const remaining = group.filter((item) => !selected.has(item.id))
            for (const item of focused) candidates.push(makeNode([item], kind === 'product' ? 'product' : 'request'))
            if (!remaining.length) continue
            const individual = remaining.length === 1 || options.mode === 'products' || (options.mode !== 'sellers' && options.filtered && group.length <= 12)
            if (individual) for (const item of remaining) candidates.push(makeNode([item], kind === 'product' ? 'product' : 'request'))
            else candidates.push(makeNode(remaining, 'seller'))
        }
    }
    candidates.sort((a, b) => Number(selected.has(b.items[0].id)) - Number(selected.has(a.items[0].id)) || a.id.localeCompare(b.id))
    // Photos depend on local crowding, not on whether this is a desktop or phone.
    if (stage === 'photos') for (const node of candidates) {
        if (node.type !== 'product' || !node.items[0].photoUrl) continue
        const nearby = candidates.filter((other) => Math.hypot(other.anchor.x - node.anchor.x, other.anchor.y - node.anchor.y) < 90).length
        if (nearby <= 12 || selected.has(node.items[0].id)) { node.preview = 'photo'; node.size = options.width < 480 ? 40 : 44 }
    }
    const placed: MapNode[] = []
    const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(Math.max(min, max), value))
    const locate = (node: MapNode): Pixel | undefined => {
        for (const radius of [0, 52, 80, 108]) {
            const steps = radius ? Math.ceil(2 * Math.PI * radius / 32) : 1
            for (let step = 0; step < steps; step++) {
                const angle = step * 2 * Math.PI / steps - Math.PI / 2
                const x = clamp(node.anchor.x + Math.cos(angle) * radius, node.size / 2 + 6, options.width - node.size / 2 - 6)
                const y = clamp(node.anchor.y + Math.sin(angle) * radius, node.size / 2 + 6, options.height - node.size / 2 - 6)
                if (placed.every((other) => Math.hypot(other.x - x, other.y - y) >= (other.size + node.size) / 2 + 8)) return { x, y }
            }
        }
    }
    for (const node of candidates) {
        let position = locate(node)
        if (!position && node.preview === 'photo') { node.preview = 'category'; node.size = 40; position = locate(node) }
        if (position) {
            Object.assign(node, position)
            node.displaced = Math.hypot(node.x - node.anchor.x, node.y - node.anchor.y) > 8
            placed.push(node)
        } else {
            // Dense streets retain an explicit numbered stack. No arbitrary product/photo collage.
            const available = placed.filter((other) => !other.items.some((item) => selected.has(item.id)))
            const sameKind = available.filter((other) => other.items.every((item) => item.kind === node.items[0].kind))
            const nearby = (sameKind.length ? sameKind : available.length ? available : placed)
                .slice().sort((a, b) => Math.hypot(a.x - node.anchor.x, a.y - node.anchor.y) - Math.hypot(b.x - node.anchor.x, b.y - node.anchor.y))[0]
            if (nearby) { nearby.type = 'cluster'; nearby.preview = 'count'; nearby.items.push(...node.items) }
            else { Object.assign(node, { x: clamp(node.x, 24, options.width - 24), y: clamp(node.y, 24, options.height - 24) }); placed.push(node) }
        }
    }
    return placed
}
export function inViewport(point: SellerProductPoint, viewport: MapViewport): boolean {
    return point.latitude >= viewport.south && point.latitude <= viewport.north &&
        (viewport.west <= viewport.east ? point.longitude >= viewport.west && point.longitude <= viewport.east : point.longitude >= viewport.west || point.longitude <= viewport.east)
}
export function clusterMapProducts(products: SellerProductPoint[], zoom: number, project: (point: SellerProductPoint) => { x: number; y: number }, stage: MapStage) {
    const groups: { latitude: number; longitude: number; products: SellerProductPoint[]; x: number; y: number }[] = []
    const spacing = stage === 'photos' ? 86 : stage === 'categories' ? 68 : 58
    for (const product of products) {
        const pixel = project(product)
        const group = zoom <= 12 ? groups[0] : groups.find((item) => Math.hypot(item.x - pixel.x, item.y - pixel.y) < spacing)
        if (group) group.products.push(product)
        else groups.push({ latitude: product.latitude, longitude: product.longitude, products: [product], ...pixel })
    }
    return groups
}
