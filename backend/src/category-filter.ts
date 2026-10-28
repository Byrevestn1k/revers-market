// Only these retired nodes are redirects; other inactive categories must stay unavailable.
export const retiredCategoryCodesSql = "'honey', 'honey_raw', 'beeswax', 'pollen', 'propolis', 'royal_jelly', 'bee_packages'"

// A root filter includes its descendants; UNION also protects against legacy cycles.
export const categoryFilterSql = (column: string, parameter: number) => `${column} IN (
    WITH RECURSIVE category_tree AS (
        SELECT canonical.id FROM categories selected
        JOIN categories canonical ON canonical.id = CASE
            WHEN selected.is_active THEN selected.id ELSE selected.parent_id END
        WHERE selected.id = $${parameter} AND canonical.is_active
          AND (selected.is_active OR selected.code IN (${retiredCategoryCodesSql}))
        UNION
        SELECT child.id FROM categories child JOIN category_tree parent ON child.parent_id = parent.id
        WHERE child.is_active
    ) SELECT id FROM category_tree
)`
