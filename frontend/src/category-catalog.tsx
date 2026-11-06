import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Category } from './categories'

export type CategoryLoadState = 'loading' | 'ready' | 'error' | 'empty'
type Catalog = { categories: Category[]; status: CategoryLoadState; retry: () => void }
const CategoryCatalogContext = createContext<Catalog | null>(null)

export function CategoryCatalogProvider({ children, load }: { children: ReactNode; load: (signal: AbortSignal) => Promise<Category[]> }) {
    const [categories, setCategories] = useState<Category[]>([])
    const [status, setStatus] = useState<CategoryLoadState>('loading')
    const pending = useRef<{ controller: AbortController; generation: number } | null>(null)
    const generation = useRef(0)
    const retry = useCallback(() => {
        if (pending.current) return
        const controller = new AbortController(), current = ++generation.current
        pending.current = { controller, generation: current }
        setStatus('loading')
        void load(controller.signal).then(result => {
            if (generation.current !== current) return
            if (!Array.isArray(result)) throw new Error('Invalid categories response')
            setCategories(result)
            setStatus(result.length ? 'ready' : 'empty')
        }).catch(() => {
            if (generation.current !== current || controller.signal.aborted) return
            setCategories([]); setStatus('error')
        }).finally(() => { if (pending.current?.generation === current) pending.current = null })
    }, [load])
    useEffect(() => {
        retry()
        return () => { generation.current++; pending.current?.controller.abort(); pending.current = null }
    }, [retry])
    return <CategoryCatalogContext.Provider value={{ categories, status, retry }}>{children}</CategoryCatalogContext.Provider>
}

export const useCategoryCatalog = () => useContext(CategoryCatalogContext)
