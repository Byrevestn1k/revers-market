export type OfferDraftData = Record<string, unknown> & { photos: string[]; photosNotSaved?: boolean }
type DraftStorage = Pick<Storage, 'setItem'>

export function saveOfferDraft(storage: DraftStorage, key: string, draft: OfferDraftData): 'complete' | 'photos-not-saved' | 'unavailable' {
    try {
        storage.setItem(key, JSON.stringify(draft))
        return draft.photosNotSaved ? 'photos-not-saved' : 'complete'
    } catch {
        try {
            storage.setItem(key, JSON.stringify({ ...draft, photos: [], photosNotSaved: draft.photos.length > 0 || Boolean(draft.photosNotSaved) }))
            return draft.photos.length > 0 || draft.photosNotSaved ? 'photos-not-saved' : 'complete'
        } catch {
            return 'unavailable'
        }
    }
}
