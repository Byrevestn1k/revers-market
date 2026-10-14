import { useEffect, useState } from 'react'
import { CategoryImage } from './CategoryPicker'
import type { Category } from './categories'
import './listing-ui.css'

export default function RequestGallery({ photos, category, title }: { photos: { url: string; alt?: string }[]; category: Category; title: string }) {
    const [selected, setSelected] = useState(0)
    useEffect(() => setSelected(0), [photos[0]?.url])
    const source = (url: string) => url.startsWith('/') ? `${import.meta.env.VITE_API_URL ?? ''}${url}` : url
    if (!photos.length) return <div className="request-gallery-empty"><CategoryImage category={category} /><span>Фото поки немає</span></div>
    return <div className="request-gallery">
        <img className="request-gallery-main" src={source(photos[Math.min(selected, photos.length - 1)].url)} alt={photos[selected]?.alt || title} />
        {photos.length > 1 && <div className="request-gallery-thumbs" aria-label="Фотографії запиту">{photos.map((photo, index) => <button key={`${photo.url}-${index}`} type="button" aria-label={`Показати фото ${index + 1}`} aria-current={selected === index} onClick={() => setSelected(index)}><img src={source(photo.url)} alt="" /></button>)}</div>}
    </div>
}
