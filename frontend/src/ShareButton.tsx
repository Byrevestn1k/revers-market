import { useEffect, useRef, useState } from 'react'
import './share.css'

type ShareType = 'product' | 'buy_request' | 'profile' | 'review'
type Payload = { publicUrl: string; title: string; shareText: string }

export default function ShareButton({ type, id, reviewId }: { type: ShareType; id: string; reviewId?: string }) {
    const [open, setOpen] = useState(false)
    const [payload, setPayload] = useState<Payload | null>(null)
    const [message, setMessage] = useState('')
    const root = useRef<HTMLDivElement>(null)
    useEffect(() => {
        if (!open) return
        const key = (event: KeyboardEvent) => { if (event.key === 'Escape') { setOpen(false); root.current?.querySelector('button')?.focus() } }
        const outside = (event: MouseEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false) }
        document.addEventListener('keydown', key); document.addEventListener('click', outside)
        return () => { document.removeEventListener('keydown', key); document.removeEventListener('click', outside) }
    }, [open])
    const show = async () => {
        if (open) { setOpen(false); return }
        setOpen(true); setMessage(''); setPayload(null)
        try {
            const response = await fetch(`/api/share/${type}/${encodeURIComponent(id)}${reviewId ? `?review=${encodeURIComponent(reviewId)}` : ''}`, { credentials: 'omit' })
            if (!response.ok) throw new Error()
            setPayload(await response.json())
        } catch { setMessage('Не вдалося підготувати поширення. Спробуйте пізніше.') }
    }
    const copy = async (value: string) => {
        try { await navigator.clipboard.writeText(value); setMessage('Скопійовано') }
        catch { setMessage('Не вдалося скопіювати. Перевірте дозвіл браузера.') }
    }
    const native = () => {
        if (!payload || !navigator.share) return
        setMessage('')
        navigator.share({ title: payload.title, text: payload.shareText.replace(payload.publicUrl, '').replace(/(?:Переглянути|Запропонувати товар):\s*$/, '').trim(), url: payload.publicUrl }).catch(error => { if (error?.name !== 'AbortError') setMessage('Не вдалося відкрити системне меню. Скористайтеся копіюванням.') })
    }
    const concise = payload?.shareText.replace(payload.publicUrl, '').replace(/(?:Переглянути|Запропонувати товар):\s*$/, '').trim().slice(0, 500) ?? ''
    return <div className="share-control" ref={root} onClick={event => event.stopPropagation()}>
        <button type="button" className="share-trigger" onClick={() => void show()} aria-expanded={open} aria-label="Поділитися"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" /><path d="M8.6 10.5 15.4 6.5M8.6 13.5l6.8 4" /></svg> <span>Поділитися</span></button>
        {open && <div className="share-menu" role="group" aria-label="Способи поширення">
            {!payload && !message && <p>Готуємо посилання…</p>}
            {payload && <>
                {typeof navigator.share === 'function' && <button type="button" onClick={native}>Системне меню</button>}
                <a href={`https://t.me/share/url?${new URLSearchParams({ url: payload.publicUrl, text: concise })}`} target="_blank" rel="noopener noreferrer">Telegram</a>
                <a href={`viber://forward?text=${encodeURIComponent(`${concise}\n${payload.publicUrl}`)}`}>Viber</a>
                <a href={`https://www.facebook.com/sharer/sharer.php?${new URLSearchParams({ u: payload.publicUrl })}`} target="_blank" rel="noopener noreferrer">Facebook</a>
                <button type="button" onClick={() => void copy(payload.publicUrl)}>Копіювати посилання</button>
                <button type="button" onClick={() => void copy(payload.shareText)}>Копіювати текст із посиланням</button>
                <small>Для Instagram скористайтеся системним меню або скопіюйте текст чи посилання.</small>
            </>}
            {message && <p role="status">{message}</p>}
        </div>}
    </div>
}
