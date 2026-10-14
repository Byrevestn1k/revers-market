import type { MouseEvent } from 'react'

export type FavoriteTargetType = 'product' | 'buy_request' | 'profile'

export default function FavoriteButton({ targetType, targetId, favorite, onFavorite, className = '' }: {
    targetType: FavoriteTargetType
    targetId: string
    favorite: boolean
    onFavorite?: (targetType: FavoriteTargetType, targetId: string) => Promise<void> | void
    className?: string
}) {
    const toggle = (event: MouseEvent<HTMLButtonElement>) => {
        event.preventDefault()
        event.stopPropagation()
        if (onFavorite) { void onFavorite(targetType, targetId); return }
        const returnPath = window.location.pathname + window.location.search
        window.location.assign(`/auth/login?return=${encodeURIComponent(returnPath)}`)
    }
    return <button
        type="button"
        className={`listing-favorite ${className}`.trim()}
        onClick={toggle}
        aria-label={favorite ? 'Прибрати з обраного' : 'Додати в обране'}
        aria-pressed={favorite}
        title={favorite ? 'Прибрати з обраного' : 'Додати в обране'}
    ><span aria-hidden="true">{favorite ? '♥' : '♡'}</span></button>
}
