import type { PoolClient } from 'pg'
import { pool } from './db/client.js'

type Queryable = Pick<PoolClient, 'query'>
export type AttributeDefinition = { code: string; label: string; valueType: 'text' | 'number' | 'number_unit' | 'single' | 'multiple' | 'boolean'; options: string[]; unit: string | null; minValue: number | null; maxValue: number | null; required: boolean; sortOrder: number }

export async function attributeDefinitions(categoryId: string, db: Queryable = pool): Promise<AttributeDefinition[]> {
    const result = await db.query(`WITH RECURSIVE ancestry AS (
        SELECT id, parent_id FROM categories WHERE id=$1 AND is_active
        UNION ALL SELECT c.id, c.parent_id FROM categories c JOIN ancestry a ON c.id=a.parent_id WHERE c.is_active
    ) SELECT DISTINCT d.code, d.label, d.value_type AS "valueType", d.options, d.unit,
        d.min_value::float8 AS "minValue", d.max_value::float8 AS "maxValue", d.required, d.sort_order AS "sortOrder"
      FROM ancestry a JOIN category_attribute_assignments x ON x.category_id=a.id
      JOIN category_attribute_definitions d ON d.code=x.attribute_code ORDER BY "sortOrder", d.code`, [categoryId])
    return result.rows
}

export async function validateAttributes(categoryId: string, input: unknown, db: Queryable = pool): Promise<boolean> {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return false
    const values = input as Record<string, unknown>
    const definitions = await attributeDefinitions(categoryId, db)
    const byCode = new Map(definitions.map(definition => [definition.code, definition]))
    if (Object.keys(values).some(code => !byCode.has(code))) return false
    for (const definition of definitions) {
        const value = values[definition.code]
        if (value === undefined) { if (definition.required) return false; continue }
        if (value === null || value === '') return false
        if (definition.valueType === 'text' && (typeof value !== 'string' || value.length > 200 || !value.trim())) return false
        if ((definition.valueType === 'number' || definition.valueType === 'number_unit') && (typeof value !== 'number' || !Number.isFinite(value) || definition.minValue !== null && value < definition.minValue || definition.maxValue !== null && value > definition.maxValue)) return false
        if (definition.valueType === 'single' && (typeof value !== 'string' || !definition.options.includes(value))) return false
        if (definition.valueType === 'multiple' && (!Array.isArray(value) || value.length > definition.options.length || new Set(value).size !== value.length || value.some(item => typeof item !== 'string' || !definition.options.includes(item)))) return false
        if (definition.valueType === 'boolean' && typeof value !== 'boolean') return false
    }
    return true
}
