import { useEffect, useRef } from 'react'
import L from 'leaflet'
import type { Coordinates } from './address-model'

export default function LocationPointPicker({ point, onChange }: { point: Coordinates | null; onChange: (point: Coordinates) => void }) {
    const container = useRef<HTMLDivElement>(null)
    const map = useRef<L.Map | null>(null)
    const marker = useRef<L.Marker | null>(null)
    const callback = useRef(onChange)
    callback.current = onChange
    useEffect(() => {
        if (!container.current) return
        const instance = L.map(container.current, { scrollWheelZoom: false }).setView(point ? [point.latitude, point.longitude] : [50.6199, 26.2516], point ? 16 : 12)
        map.current = instance
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(instance)
        instance.on('click', (event: L.LeafletMouseEvent) => callback.current({ latitude: Number(event.latlng.lat.toFixed(6)), longitude: Number(event.latlng.wrap().lng.toFixed(6)) }))
        const resize = new ResizeObserver(() => instance.invalidateSize())
        resize.observe(container.current)
        return () => { resize.disconnect(); instance.remove(); map.current = null; marker.current = null }
    }, [])
    useEffect(() => {
        if (!map.current) return
        if (marker.current) { marker.current.remove(); marker.current = null }
        if (!point) return
        const position: L.LatLngExpression = [point.latitude, point.longitude]
        const pin = L.marker(position, { draggable: true, icon: L.divIcon({ className: 'profile-public-pin', html: '<span aria-hidden="true">●</span>', iconSize: [34, 42], iconAnchor: [17, 42] }) }).addTo(map.current)
        pin.on('dragend', () => { const next = pin.getLatLng().wrap(); callback.current({ latitude: Number(next.lat.toFixed(6)), longitude: Number(next.lng.toFixed(6)) }) })
        marker.current = pin
        map.current.panTo(position)
    }, [point?.latitude, point?.longitude])
    return <div ref={container} className="profile-point-picker" role="region" aria-label="Оберіть публічну точку натисканням на мапі" />
}
