export type Queryable = Pick<{ query: (...args: any[]) => any }, 'query'>

/**
 * Builds a dynamic SQL UPDATE for the whitelisted fields present in `input`.
 * Returns the SET assignments, the positional values, and the parameter
 * indexes for the two trailing WHERE conditions (id and owner).
 */
export const buildUpdate = (
    allowed: Record<string, string>,
    input: Record<string, unknown>,
): { assignments: string[]; values: unknown[] } => {
    const entries = Object.entries(input).filter(([key]) => key in allowed)
    const values = entries.map(([, value]) => value)
    const assignments = entries.map(([key], index) => `${allowed[key]} = $${index + 1}`)
    return { assignments, values }
}

export const withOwnerConditions = (values: unknown[], id: string, ownerId: string) => {
    values.push(id, ownerId)
    return { idParam: `$${values.length - 1}`, ownerParam: `$${values.length}` }
}
