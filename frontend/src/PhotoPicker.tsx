import { useState } from 'react'
import { FieldError } from './ListingFields'
import './listing-ui.css'

const fileTypes = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
const imageSource = (url: string) => url.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${url}` : url

function PhotoPreview({ photo, index }: { photo: string; index: number }) {
    const [failed, setFailed] = useState(false)
    return failed ? <span className="photo-picker-unavailable" role="img" aria-label={`Фото ${index + 1} недоступне`}>Фото недоступне</span> : <img src={imageSource(photo)} alt={`Фото ${index + 1}`} onError={() => setFailed(true)} />
}

export default function PhotoPicker({ photos, onChange, max, error, allowLinks = false }: {
    photos: string[]; onChange: (photos: string[]) => void; max: number; error?: string; allowLinks?: boolean
}) {
    const [localError, setLocalError] = useState('')
    const [link, setLink] = useState('')
    const addFiles = async (files: FileList | null) => {
        if (!files?.length) return
        const selected = Array.from(files)
        if (photos.length + selected.length > max) { setLocalError(`Можна додати до ${max} фото.`); return }
        if (selected.some(file => !fileTypes.has(file.type) || file.size > 5 * 1024 * 1024)) { setLocalError('Оберіть PNG, JPG, WEBP або GIF розміром до 5 МБ.'); return }
        try {
            const next = await Promise.all(selected.map(file => new Promise<string>((resolve, reject) => {
                const reader = new FileReader()
                reader.onload = () => resolve(String(reader.result))
                reader.onerror = () => reject(new Error('Не вдалося прочитати фото.'))
                reader.readAsDataURL(file)
            })))
            onChange([...photos, ...next]); setLocalError('')
        } catch { setLocalError('Не вдалося прочитати фото.') }
    }
    const move = (index: number, direction: number) => {
        const next = [...photos]
        ;[next[index], next[index + direction]] = [next[index + direction], next[index]]
        onChange(next)
    }
    return <div className="photo-picker">
        <div className="photo-picker-grid">{photos.map((photo, index) => <div className="photo-picker-item" key={`${photo}-${index}`}>
            <PhotoPreview photo={photo} index={index} />
            {index === 0 && <span className="photo-picker-main">Головне</span>}
            <div className="photo-picker-actions"><button type="button" aria-label={`Перемістити фото ${index + 1} ліворуч`} disabled={index === 0} onClick={() => move(index, -1)}>←</button><button type="button" aria-label={`Перемістити фото ${index + 1} праворуч`} disabled={index === photos.length - 1} onClick={() => move(index, 1)}>→</button><button type="button" aria-label={`Видалити фото ${index + 1}`} onClick={() => onChange(photos.filter((_, position) => position !== index))}>×</button></div>
        </div>)}</div>
        <label>Додати фотографії<input type="file" accept="image/png,image/jpeg,image/webp,image/gif" multiple disabled={photos.length >= max} onChange={event => { void addFiles(event.target.files); event.target.value = '' }} /></label>
        {allowLinks && <div className="photo-picker-link"><label>Або посилання на фото<input type="url" value={link} onChange={event => setLink(event.target.value)} placeholder="https://…" /></label><button type="button" className="outline-button compact" onClick={() => { if (link && photos.length < max) { onChange([...photos, link]); setLink('') } }}>Додати</button></div>}
        <small>До {max} фото, до 5 МБ кожне. Перше фото показується на картці.</small>
        <FieldError message={localError || error} />
    </div>
}
