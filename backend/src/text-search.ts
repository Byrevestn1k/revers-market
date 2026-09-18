// User-entered words are literal text, not LIKE patterns. All words must match.
export function textSearchConditions(columns: string[], query: string | undefined, parameters: unknown[]): string[] {
    const words = query?.trim().slice(0, 160).split(/\s+/).filter(Boolean) ?? []
    return words.map((word) => {
        const index = parameters.push(`%${word.replace(/[\\%_]/g, '\\$&')}%`)
        return `(${columns.map((column) => `${column} ILIKE $${index}`).join(' OR ')})`
    })
}
