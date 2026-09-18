// A root filter includes its descendants; UNION also protects against legacy cycles.
export const categoryFilterSql = (column: string, parameter: number) => `${column} IN (
    WITH RECURSIVE category_tree AS (
        SELECT id FROM categories WHERE id = $${parameter} AND is_active
        UNION
        SELECT child.id FROM categories child JOIN category_tree parent ON child.parent_id = parent.id
        WHERE child.is_active
    ) SELECT id FROM category_tree
)`
