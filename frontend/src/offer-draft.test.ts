import { describe, expect, it } from 'vitest'
import { saveOfferDraft } from './offer-draft'

describe('seller offer draft', () => {
    it('keeps the complete draft when the browser accepts it', () => {
        let saved = ''
        const result = saveOfferDraft({ setItem: (_key, value) => { saved = value } }, 'draft', { title: 'Товар', photos: ['data:image/png;base64,AA=='] })
        expect(result).toBe('complete')
        expect(JSON.parse(saved).photos).toHaveLength(1)
    })

    it('marks missing photos when storage only has room for text', () => {
        let saved = ''
        const result = saveOfferDraft({ setItem: (_key, value) => { if (JSON.parse(value).photos.length) throw new DOMException('Full', 'QuotaExceededError'); saved = value } }, 'draft', { title: 'Товар', photos: ['large photo'] })
        expect(result).toBe('photos-not-saved')
        expect(JSON.parse(saved)).toMatchObject({ title: 'Товар', photos: [], photosNotSaved: true })
    })

    it('reports when no draft can be saved', () => {
        expect(saveOfferDraft({ setItem: () => { throw new Error('Disabled') } }, 'draft', { title: 'Товар', photos: ['photo'] })).toBe('unavailable')
    })
})
