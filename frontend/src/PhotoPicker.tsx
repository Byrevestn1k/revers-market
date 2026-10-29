import { useEffect, useRef, useState } from 'react'
import { FieldError } from './ListingFields'
import './listing-ui.css'

const fileTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const imageSource = (url: string) => url.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${url}` : url

function PhotoPreview({ photo, index }: { photo: string; index: number }) {
    const [failed, setFailed] = useState(false)
    return failed ? <span className="photo-picker-unavailable" role="img" aria-label={`Фото ${index + 1} недоступне`}>Фото недоступне</span> : <img src={imageSource(photo)} alt={`Фото ${index + 1}`} draggable={false} onError={() => setFailed(true)} />
}

export default function PhotoPicker({ photos, onChange, max, error, allowLinks = false }: {
    photos: string[]; onChange: (photos: string[]) => void; max: number; error?: string; allowLinks?: boolean
}) {
    const [localError, setLocalError] = useState('')
    const [link, setLink] = useState('')
    const [reading, setReading] = useState(false)
    const [draggingIndex, setDraggingIndex] = useState<number | null>(null)
    const dragging = useRef<number | null>(null)
    const container = useRef<HTMLDivElement>(null)
    const readingRef = useRef(false)
    useEffect(() => {
        const form = container.current?.closest('form')
        const preventSubmit = (event: Event) => { if (readingRef.current) { event.preventDefault(); event.stopPropagation() } }
        form?.addEventListener('submit', preventSubmit, true)
        return () => form?.removeEventListener('submit', preventSubmit, true)
    }, [])
    const addFiles = async (files: FileList | null) => {
        if (!files?.length || reading) return
        const selected = Array.from(files)
        if (photos.length + selected.length > max) { setLocalError(`Можна додати не більше ${max} фотографій. Зараз доступно ще ${Math.max(0, max - photos.length)}.`); return }
        const valid = selected.filter(file => fileTypes.has(file.type) && file.size <= 5 * 1024 * 1024)
        const hasInvalid = valid.length !== selected.length
        if (!valid.length) { setLocalError('Оберіть PNG, JPG, WEBP або GIF розміром до 5 МБ.'); return }
        readingRef.current = true; setReading(true)
        try {
            const results = await Promise.allSettled(valid.map(file => new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => {
                    const data = String(reader.result)
                    const image = new Image()
                    image.onload = () => resolve(data)
                    image.onerror = () => reject(new Error('Пошкоджене фото'))
                    image.src = data
                }
                reader.onerror = () => reject(new Error('Не вдалося прочитати фото.'))
                reader.readAsDataURL(file)
            })))
            const next = results.flatMap(result => result.status === 'fulfilled' ? [result.value] : [])
            onChange([...photos, ...next]); setLocalError((hasInvalid || results.some(result => result.status === 'rejected')) ? 'Деякі фото пошкоджені, мають непідтримуваний формат або перевищують 5 МБ. Спробуйте додати їх знову.' : '')
        } finally { readingRef.current = false; setReading(false) }
    }
    const move = (index: number, direction: number) => {
        const next = [...photos]
        ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
        onChange(next)
    }
    const moveTo = (from: number, to: number) => {
        if (from === to || from < 0 || to < 0 || from >= photos.length || to >= photos.length) return
        const next = [...photos]
        const [item] = next.splice(from, 1)
        next.splice(to, 0, item)
        onChange(next)
    }
    return <div className="photo-picker" ref={container}>
        <small>Фото: {photos.length} із {max}</small>
        <div className="photo-picker-grid">{photos.map((photo, index) => <div className={`photo-picker-item${draggingIndex === index ? ' is-dragging' : ''}`} key={`${photo}-${index}`} onPointerUp={event => {
            const from = dragging.current
            dragging.current = null
            setDraggingIndex(null)
            if (reading || from === null) return
            const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('[data-photo-index]')
            if (target) moveTo(from, Number(target.getAttribute('data-photo-index')))
        }} data-photo-index={index}>
            <div className="photo-picker-drag" title="Перетягніть фото" onPointerDown={event => { if (reading) return; dragging.current = index; setDraggingIndex(index); event.currentTarget.setPointerCapture(event.pointerId) }} onPointerCancel={() => { dragging.current = null; setDraggingIndex(null) }}><PhotoPreview photo={photo} index={index} /><span aria-hidden="true">↕</span></div>
            {index === 0 && <span className="photo-picker-main">Головне</span>}
            <div className="photo-picker-actions"><button type="button" aria-label={`Перемістити фото ${index + 1} ліворуч`} disabled={reading || index === 0} onClick={() => move(index, -1)}>←</button><button type="button" aria-label={`Перемістити фото ${index + 1} праворуч`} disabled={reading || index === photos.length - 1} onClick={() => move(index, 1)}>→</button><button type="button" aria-label={`Видалити фото ${index + 1}`} disabled={reading} onClick={() => onChange(photos.filter((_, position) => position !== index))}>×</button></div>
        </div>)}</div>
        <label>Додати фотографії<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={photos.length >= max || reading} onChange={event => { void addFiles(event.target.files); event.target.value = '' }} /></label>
        {allowLinks && <div className="photo-picker-link"><label>Або посилання на фото<input type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="https://…" /></label><button type="button" className="outline-button compact" onClick={() => { if (link && photos.length < max) { onChange([...photos, link]); setLink('') } }}>Додати</button></div>}
        <small>{reading ? 'Читаємо фотографії… ' : ''}До {max} фото, до 5 МБ кожне. Перше фото показується на картці.</small>
        <FieldError message={localError || error} />
    </div>
}
