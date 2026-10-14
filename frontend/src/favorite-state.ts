import type { FavoriteTargetType } from './FavoriteButton'

export type FavoriteRecord = { targetType: FavoriteTargetType; targetId: string }

export const favoriteKey = (targetType: FavoriteTargetType, targetId: string) => `${targetType}:${targetId}`

export function favoriteKeys(items: FavoriteRecord[]) {
    return new Set(items.map(item => favoriteKey(item.targetType, item.targetId)))
}

export function withFavorite(keys: ReadonlySet<string>, targetType: FavoriteTargetType, targetId: string, favorite: boolean) {
    const next = new Set(keys)
    const key = favoriteKey(targetType, targetId)
    if (favorite) next.add(key)
    else next.delete(key)
    return next
}

export function uniqueFavorites<T extends FavoriteRecord>(items: T[]) {
    const seen = new Set<string>()
    return items.filter(item => {
        const key = favoriteKey(item.targetType, item.targetId)
        if (seen.has(key)) return false
        seen.add(key)
        return true
    })
}
