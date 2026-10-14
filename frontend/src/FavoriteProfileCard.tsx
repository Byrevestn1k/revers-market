import FavoriteButton, { type FavoriteTargetType } from './FavoriteButton'

export type FavoriteProfileCardData = {
    id: string
    username: string
    nickname?: string | null
    avatarUrl?: string | null
    bio?: string | null
    location?: string | null
    ratingSummary?: { average: number | null; count: number }
    statistics?: { listingsCount: number; completedDealsCount: number }
}

export default function FavoriteProfileCard({ profile, onOpen, favorite = false, onFavorite, imageUrl }: {
    profile: FavoriteProfileCardData
    onOpen: () => void
    favorite?: boolean
    onFavorite?: (targetType: FavoriteTargetType, targetId: string) => Promise<void> | void
    imageUrl: (url: string) => string
}) {
    const name = profile.nickname || profile.username
    const initials = name.trim().split(/\s+/).slice(0, 2).map(part => part[0]?.toLocaleUpperCase('uk-UA')).join('') || '?'
    return <article className="favorite-profile-card listing-card">
        <button type="button" className="favorite-profile-open" onClick={onOpen} aria-label={'Відкрити профіль: ' + name}>
            <span className="favorite-profile-avatar">{profile.avatarUrl ? <img src={imageUrl(profile.avatarUrl)} alt={'Аватар ' + name} /> : initials}</span>
            <span className="favorite-profile-copy"><strong>{name}</strong><small>@{profile.username}{profile.location ? ' · ⌖ ' + profile.location : ''}</small><p>{profile.bio || 'Користувач ще не додав публічний опис.'}</p><small>★ {profile.ratingSummary?.average ?? '—'} · {profile.statistics?.listingsCount ?? 0} оголошень</small></span>
        </button>
        <FavoriteButton targetType="profile" targetId={profile.id} favorite={favorite} onFavorite={onFavorite} />
    </article>
}
