import { useEffect, useRef, useState } from 'react'
import { CategoryImage } from './CategoryPicker'
import type { Category } from './categories'
import './listing-ui.css'

const source = (url: string) => url.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${url}` : url

function GalleryThumbnail({ url, position, selected, onSelect }: { url: string; position: number; selected: boolean; onSelect: () => void }) {
    const button = useRef<HTMLButtonElement>(null)
    const [visible, setVisible] = useState(false)
    useEffect(() => {
        const element = button.current
        if (!element || typeof IntersectionObserver === 'undefined') { setVisible(true); return }
        const observer = new IntersectionObserver(entries => {
            if (entries.some(entry => entry.isIntersecting)) { setVisible(true); observer.disconnect() }
        }, { root: element.parentElement, threshold: 0.01 })
        observer.observe(element)
        return () => observer.disconnect()
    }, [url])
    const thumbnail = /^\/uploads\/(products|buy-requests)\/[0-9a-f-]{36}(?:\/[0-9a-f-]{36})?\/\d+\.(jpg|png|webp|gif)$/i.test(url)
        ? source('/api/photo-thumbnail?path=' + encodeURIComponent(url)) : source(url)
    return <button ref={button} type="button" aria-label={`Показати фото ${position + 1}`} aria-current={selected} onClick={onSelect}>
        {visible ? <img src={thumbnail} alt="" loading="lazy" onError={event => { event.currentTarget.hidden = true }} /> : <span className="gallery-thumb-pending" />}
        <span className="gallery-thumb-fallback">Фото недоступне</span>
    </button>
}

export default function RequestGallery({ photos, category, title }: { photos: { url: string; alt?: string }[]; category: Category; title: string }) {
    const openButton = useRef<HTMLButtonElement>(null)
    const closeButton = useRef<HTMLButtonElement>(null)
    const dialog = useRef<HTMLDivElement>(null)
    const [selected, setSelected] = useState(0)
    const [expanded, setExpanded] = useState(false)
    const [touchStart, setTouchStart] = useState<number | null>(null)
    useEffect(() => setSelected(0), [photos[0]?.url])
    useEffect(() => {
        if (!expanded) return
        const previousOverflow = document.body.style.overflow
        document.body.style.overflow = 'hidden'
        closeButton.current?.focus()
        const key = (event: KeyboardEvent) => {
            if (event.key === 'Tab') {
                const buttons = Array.from(dialog.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])
                if (buttons.length) {
                    const current = buttons.indexOf(document.activeElement as HTMLButtonElement)
                    if (event.shiftKey && current <= 0) { event.preventDefault(); buttons[buttons.length - 1].focus() }
                    else if (!event.shiftKey && (current === -1 || current === buttons.length - 1)) { event.preventDefault(); buttons[0].focus() }
                }
            }
            if (event.key === 'Escape') setExpanded(false)
            if (event.key === 'ArrowLeft') setSelected(index => (index + photos.length - 1) % photos.length)
            if (event.key === 'ArrowRight') setSelected(index => (index + 1) % photos.length)
        }
        window.addEventListener('keydown', key)
        return () => { window.removeEventListener('keydown', key); document.body.style.overflow = previousOverflow; openButton.current?.focus() }
    }, [expanded, photos.length])
    if (!photos.length) return <div className="request-gallery-empty"><CategoryImage category={category} /><span>Фото поки немає</span></div>
    const index = Math.min(selected, photos.length - 1)
    const move = (direction: number) => setSelected((index + direction + photos.length) % photos.length)
    const picture = <img className="request-gallery-main" src={source(photos[index].url)} alt={photos[index].alt || title} />
    const controls = photos.length > 1 && <div className="gallery-controls"><button type="button" aria-label="Попереднє фото" onClick={() => move(-1)}>←</button><span aria-live="polite">{index + 1} / {photos.length}</span><button type="button" aria-label="Наступне фото" onClick={() => move(1)}>→</button></div>
    return <div className="request-gallery" onTouchStart={event => setTouchStart(event.touches[0].clientX)} onTouchEnd={event => { if (touchStart !== null) { const delta = event.changedTouches[0].clientX - touchStart; if (Math.abs(delta) > 50) move(delta < 0 ? 1 : -1); setTouchStart(null) } }}>
        <button type="button" className="gallery-open" ref={openButton} aria-label="Збільшити фото" onClick={() => setExpanded(true)}>{picture}</button>
        {controls}
        {photos.length > 1 && <div className="request-gallery-thumbs" aria-label="Фотографії оголошення">{photos.map((photo, position) => <GalleryThumbnail key={`${photo.url}-${position}`} url={photo.url} position={position} selected={index === position} onSelect={() => setSelected(position)} />)}</div>}
        {expanded && <div className="gallery-overlay" ref={dialog} role="dialog" aria-modal="true" aria-label="Перегляд фотографій" onClick={() => setExpanded(false)}><div onClick={event => event.stopPropagation()}><button type="button" className="gallery-close" ref={closeButton} aria-label="Закрити" onClick={() => setExpanded(false)}>×</button>{picture}{controls}</div></div>}
    </div>
}
