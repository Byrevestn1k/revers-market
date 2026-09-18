export type Category = { id: string; code?: string; name: string; parentId: string | null; path?: string; imageIndex?: number | null; sortOrder?: number }

export function categoryTrail(categories: Category[], id: string, byId = new Map(categories.map((item) => [item.id, item]))): Category[] {
    const trail: Category[] = []
    const seen = new Set<string>()
    let current = byId.get(id)
    while (current && !seen.has(current.id)) {
        seen.add(current.id); trail.unshift(current)
        current = current.parentId ? byId.get(current.parentId) : undefined
    }
    return trail
}

export const categoryLabel = (categories: Category[], id: string) => categoryTrail(categories, id).map((item) => item.name).join(' › ')
export function categoryLabels(categories: Category[]) {
    const byId = new Map(categories.map((item) => [item.id, item]))
    return new Map(categories.map((item) => [item.id, categoryTrail(categories, item.id, byId).map((parent) => parent.name).join(' › ')]))
}
export const categoryChildren = (categories: Category[], parentId: string | null) => categories.filter((item) => (item.parentId ?? null) === parentId).sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0) || a.name.localeCompare(b.name, 'uk'))
