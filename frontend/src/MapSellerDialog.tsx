import { useEffect, useRef, useState } from 'react'

type Profile = { id: string; username: string; nickname?: string | null; bio?: string | null; avatarUrl?: string | null; location?: string | null; exactAddress?: string | null; phone?: string | null; statistics: { listingsCount: number; completedDealsCount: number; responseRate: number | null }; ratingSummary: { average: number | null; count: number } }
export default function MapSellerDialog({ username, request, imageUrl, onClose }: { username: string; request: (path: string, options?: RequestInit) => Promise<any>; imageUrl: (url: string) => string; onClose: () => void }) {
    const [profile, setProfile] = useState<Profile | null>(null)
    const [error, setError] = useState('')
    const closeButton = useRef<HTMLButtonElement>(null)
    useEffect(() => {
        const previous = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        return () => { document.body.style.overflow = previous }
    }, [])
    useEffect(() => {
        const controller = new AbortController()
        setProfile(null); setError(''); closeButton.current?.focus()
        request('/api/profiles/' + encodeURIComponent(username), { signal: controller.signal }).then(result => { if (!controller.signal.aborted) setProfile(result.profile) }).catch(error => { if (!controller.signal.aborted) setError(error.message) })
        return () => controller.abort()
    }, [username])
    return <div className="map-profile-backdrop" onClick={onClose}><section className="map-profile-dialog" role="dialog" aria-modal="true" aria-label="Профіль продавця або покупця" onClick={event => event.stopPropagation()} onKeyDown={event => {
        if (event.key === 'Escape') { event.stopPropagation(); onClose() }
        if (event.key === 'Tab') {
            const controls = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button, a[href]'))
            if (event.shiftKey && document.activeElement === controls[0]) { event.preventDefault(); controls.at(-1)?.focus() }
            else if (!event.shiftKey && document.activeElement === controls.at(-1)) { event.preventDefault(); controls[0]?.focus() }
        }
    }}>
        <button type="button" ref={closeButton} className="modal-close" onClick={onClose} aria-label="Закрити профіль">×</button>
        {error ? <p role="alert">{error}</p> : !profile ? <p role="status">Завантажуємо профіль…</p> : <>
            <header>{profile.avatarUrl && <img src={imageUrl(profile.avatarUrl)} alt="" />}<div><span className="eyebrow">Профіль користувача</span><h2>{profile.nickname || profile.username}</h2><p>@{profile.username}</p></div></header>
            <p>{profile.bio || 'Користувач ще не додав опис.'}</p>
            <p>⌖ {profile.exactAddress || profile.location || 'Місце не вказано'}</p>
            <dl className="map-preview-facts"><div><dt>Оголошення</dt><dd>{profile.statistics.listingsCount}</dd></div><div><dt>Завершені угоди</dt><dd>{profile.statistics.completedDealsCount}</dd></div><div><dt>Рейтинг</dt><dd>{profile.ratingSummary.count ? `${profile.ratingSummary.average} · ${profile.ratingSummary.count} відгуків` : 'Ще немає відгуків'}</dd></div></dl>
            {profile.phone && <a className="primary-button compact" href={'tel:' + profile.phone}>Зателефонувати: {profile.phone}</a>}
        </>}
        <button type="button" className="outline-button compact" onClick={onClose}>Повернутися до мапи</button>
    </section></div>
}
