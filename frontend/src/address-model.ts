export type Coordinates = { latitude: number; longitude: number }
export type AddressValue = { address: string; city: string; coordinates: Coordinates | null }
export const emptyAddress = (): AddressValue => ({ address: '', city: '', coordinates: null })
export function validCoordinates(point: Coordinates | null | undefined): point is Coordinates {
    return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180)
}
export function addressFields(location: AddressValue) {
    return { address: location.address.trim() || null, ...(validCoordinates(location.coordinates) ? location.coordinates : {}) }
}
