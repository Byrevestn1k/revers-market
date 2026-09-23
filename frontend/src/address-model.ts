export type Coordinates = { latitude: number; longitude: number }
import type { SelectedSettlement } from './settlement-model'
export type AddressVisibility = 'private' | 'public'
export type AddressValue = { address: string; city: string; coordinates: Coordinates | null; settlement?: SelectedSettlement | null; addressVisibility?: AddressVisibility; addressVisibilityConsent?: boolean }
export const emptyAddress = (): AddressValue => ({ address: '', city: '', coordinates: null, addressVisibility: 'private', addressVisibilityConsent: false })
export function validCoordinates(point: Coordinates | null | undefined): point is Coordinates {
    return Boolean(point && Number.isFinite(point.latitude) && Number.isFinite(point.longitude) && point.latitude >= -90 && point.latitude <= 90 && point.longitude >= -180 && point.longitude <= 180)
}
export function addressFields(location: AddressValue) {
    return { address: location.address.trim() || null, settlementCode: location.settlement?.code ?? null, addressVisibility: location.addressVisibility ?? 'private', addressVisibilityConsent: location.addressVisibility === 'public' && location.addressVisibilityConsent === true, ...(validCoordinates(location.coordinates) ? location.coordinates : { latitude: null, longitude: null }) }
}
