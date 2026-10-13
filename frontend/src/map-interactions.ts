export type MapFocusSource = 'marker' | 'cluster' | 'list'

export function mapFocusPlan(point: { latitude: number; longitude: number }, currentZoom: number, source: MapFocusSource) {
    const minimumZoom = source === 'list' ? 14 : currentZoom
    const zoom = source === 'cluster' ? Math.min(19, currentZoom + 2) : Math.max(currentZoom, minimumZoom)
    return { center: [point.latitude, point.longitude] as [number, number], zoom, scrollToMap: source === 'list' }
}
