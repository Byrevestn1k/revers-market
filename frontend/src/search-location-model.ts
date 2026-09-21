import { validCoordinates, type Coordinates, type AddressValue } from './address-model'
export type HomeCity = Coordinates & { name: string }
export const CITIES: HomeCity[] = [
    { name: 'Київ', latitude: 50.45, longitude: 30.52 },
    { name: 'Рівне', latitude: 50.62, longitude: 26.25 },
    { name: 'Львів', latitude: 49.84, longitude: 24.03 },
    { name: 'Луцьк', latitude: 50.75, longitude: 25.34 },
    { name: 'Тернопіль', latitude: 49.55, longitude: 25.59 },
    { name: 'Івано-Франківськ', latitude: 48.92, longitude: 24.71 },
    { name: 'Ужгород', latitude: 48.62, longitude: 22.30 },
    { name: 'Чернівці', latitude: 48.29, longitude: 25.94 },
    { name: 'Хмельницький', latitude: 49.42, longitude: 26.99 },
    { name: 'Житомир', latitude: 50.25, longitude: 28.66 },
    { name: 'Вінниця', latitude: 49.23, longitude: 28.47 },
    { name: 'Одеса', latitude: 46.48, longitude: 30.72 },
    { name: 'Миколаїв', latitude: 46.98, longitude: 31.99 },
    { name: 'Херсон', latitude: 46.64, longitude: 32.62 },
    { name: 'Дніпро', latitude: 48.46, longitude: 35.05 },
    { name: 'Запоріжжя', latitude: 47.84, longitude: 35.14 },
    { name: 'Харків', latitude: 49.99, longitude: 36.23 },
    { name: 'Полтава', latitude: 49.59, longitude: 34.55 },
    { name: 'Суми', latitude: 50.91, longitude: 34.80 },
    { name: 'Чернігів', latitude: 51.50, longitude: 31.29 },
    { name: 'Черкаси', latitude: 49.44, longitude: 32.06 },
    { name: 'Кропивницький', latitude: 48.51, longitude: 32.26 },
    { name: 'Донецьк', latitude: 48.02, longitude: 37.80 },
    { name: 'Луганськ', latitude: 48.57, longitude: 39.31 },
    { name: 'Сімферополь', latitude: 44.95, longitude: 34.10 },
    { name: 'Кривий Ріг', latitude: 47.91, longitude: 33.39 },
    { name: 'Млинів', latitude: 50.51, longitude: 25.62 },
]
export const CITY_KEY = 'deshchotreba.home-city'
export function profileSearchAddress(profile: { exactAddress: string; location?: string; mapLocation?: { mode: string; latitude: number; longitude: number } }, geocoded?: any): AddressValue {
    const candidate = geocoded?.position ? { latitude: geocoded.position.lat, longitude: geocoded.position.lng } : null
    const confirmed = profile.mapLocation?.mode === 'address' && validCoordinates(profile.mapLocation) ? { latitude: profile.mapLocation.latitude, longitude: profile.mapLocation.longitude } : null
    return { address: profile.exactAddress, city: geocoded?.address?.city || profile.exactAddress.split(',')[0].replace(/^м\.\s*/i, '').trim() || profile.location || '', coordinates: validCoordinates(candidate) ? candidate : confirmed }
}
export function normalizeCity(name: string) { return name.trim().replace(/^м[.\s]+/iu, '').toLocaleLowerCase('uk-UA') }
export function savedSearchCity(): HomeCity | null {
    try {
        const value = JSON.parse(localStorage.getItem(CITY_KEY) || 'null')
        return value && typeof value.name === 'string' && value.name.length <= 120 && Number.isFinite(value.latitude) && Math.abs(value.latitude) <= 90 && Number.isFinite(value.longitude) && Math.abs(value.longitude) <= 180 ? value : null
    } catch { return null }
}
export function distanceKm(a: Coordinates, b: Coordinates) {
    const radians = Math.PI / 180
    const h = Math.sin((b.latitude - a.latitude) * radians / 2) ** 2 + Math.cos(a.latitude * radians) * Math.cos(b.latitude * radians) * Math.sin((b.longitude - a.longitude) * radians / 2) ** 2
    return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}
export function nearestZoom(home: Coordinates, points: Coordinates[], width: number, height: number): number {
    if (!points.length) return 12
    const nearest = points.map(point => ({ point, distance: distanceKm(home, point) })).sort((a, b) => a.distance - b.distance)
    const radius = Math.max(.1, nearest[0].distance * 1.5)
    const targets = nearest.filter(item => item.distance <= radius).map(item => item.point)
    const project = (point: Coordinates) => {
        const lat = Math.max(-85.051128, Math.min(85.051128, point.latitude)) * Math.PI / 180
        return { x: (point.longitude + 180) / 360, y: (1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2 }
    }
    const origin = project(home)
    for (let zoom = 19; zoom >= 3; zoom--) {
        const scale = 256 * 2 ** zoom
        if (targets.every(point => {
            const pixel = project(point), dx = Math.abs(pixel.x - origin.x)
            return Math.min(dx, 1 - dx) * scale <= Math.max(24, width / 2 - 70) && Math.abs(pixel.y - origin.y) * scale <= Math.max(24, height / 2 - 70)
        })) return zoom
    }
    return 3
}
export function parseIpCity(data: any): HomeCity | null {
    const location = data?.location ?? data
    const country = location?.country_code ?? location?.country
    if (!['UA', 'Ukraine'].includes(country) || data?.is_bogon || data?.is_vpn || data?.is_proxy || data?.is_tor) return null
    const latitude = location?.latitude ?? location?.lat, longitude = location?.longitude ?? location?.lon
    if (!Number.isFinite(latitude) || Math.abs(latitude) > 90 || !Number.isFinite(longitude) || Math.abs(longitude) > 180 || typeof location?.city !== 'string' || !location.city.trim()) return null
    // Translate the supported cities locally; never replace a smaller town with a distant city.
    const nearest = CITIES.reduce((a, b) => distanceKm(a, { latitude, longitude }) < distanceKm(b, { latitude, longitude }) ? a : b)
    return distanceKm(nearest, { latitude, longitude }) < 8 ? nearest : { name: location.city.slice(0, 120), latitude, longitude }
}
