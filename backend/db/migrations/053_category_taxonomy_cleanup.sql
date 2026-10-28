-- Step 20. Keep retired category rows and their UUIDs for historical references.
-- The migration runner wraps this file in a transaction.
DO $$
BEGIN
    -- Moving live-bee nodes changes the reach of their old and new parents.
    -- Do not silently broaden or narrow any existing parent subscription.
    IF EXISTS (
        SELECT 1 FROM demand_subscriptions s
        JOIN categories parent ON parent.id = s.category_id
        WHERE (parent.code = 'apiculture' AND EXISTS (
              SELECT 1 FROM categories honey WHERE honey.code = 'honey' AND honey.is_active
          )) OR (parent.code IN ('apiculture', 'livestock') AND EXISTS (
              SELECT 1 FROM categories bees
              JOIN categories old_parent ON old_parent.id = bees.parent_id
              WHERE bees.code IN ('bees', 'queen_bees') AND old_parent.code = 'apiculture'
          )) OR (parent.code = 'bees' AND EXISTS (
              SELECT 1 FROM categories packages WHERE packages.code = 'bee_packages' AND packages.is_active
          ))
    ) THEN
        RAISE EXCEPTION 'Step 20 requires review of parent subscriptions before moving live-bee categories';
    END IF;
    IF EXISTS (
        SELECT 1 FROM demand_subscriptions s
        JOIN categories c ON c.id = s.category_id
        WHERE c.code = 'honey_raw'
    ) THEN
        RAISE EXCEPTION 'Step 20 requires explicit review of honey subscriptions before migration';
    END IF;
    IF EXISTS (
        SELECT 1 FROM demand_subscriptions s
        JOIN categories c ON c.id = s.category_id
        WHERE c.code IN ('honey', 'beeswax', 'pollen', 'propolis', 'royal_jelly', 'bee_packages')
    ) THEN
        RAISE EXCEPTION 'Step 20 requires a subscription review for retired non-honey categories';
    END IF;
END $$;

WITH redirects(old_code, new_code) AS (
    VALUES
        ('honey', 'apiculture'),
        ('honey_raw', 'apiculture'),
        ('beeswax', 'apiculture'),
        ('pollen', 'apiculture'),
        ('propolis', 'apiculture'),
        ('royal_jelly', 'apiculture'),
        ('bee_packages', 'bees')
), mapping AS (
    SELECT old.id AS old_id, canonical.id AS new_id
    FROM redirects r
    JOIN categories old ON old.code = r.old_code
    JOIN categories canonical ON canonical.code = r.new_code
)
UPDATE products p SET category_id = mapping.new_id
FROM mapping WHERE p.category_id = mapping.old_id;

WITH redirects(old_code, new_code) AS (
    VALUES
        ('honey', 'apiculture'), ('honey_raw', 'apiculture'),
        ('beeswax', 'apiculture'), ('pollen', 'apiculture'),
        ('propolis', 'apiculture'), ('royal_jelly', 'apiculture'),
        ('bee_packages', 'bees')
), mapping AS (
    SELECT old.id AS old_id, canonical.id AS new_id
    FROM redirects r
    JOIN categories old ON old.code = r.old_code
    JOIN categories canonical ON canonical.code = r.new_code
)
UPDATE buy_requests r SET category_id = mapping.new_id
FROM mapping WHERE r.category_id = mapping.old_id;

-- Retired nodes remain as redirects via parent_id for old category filters.
UPDATE categories old
SET parent_id = canonical.id, is_active = false, updated_at = now()
FROM (VALUES
    ('honey', 'apiculture'), ('honey_raw', 'apiculture'),
    ('beeswax', 'apiculture'), ('pollen', 'apiculture'),
    ('propolis', 'apiculture'), ('royal_jelly', 'apiculture'),
    ('bee_packages', 'bees')
) AS redirects(old_code, new_code), categories canonical
WHERE old.code = redirects.old_code AND canonical.code = redirects.new_code;

-- Live bees belong with livestock; the overlapping package node is retired above.
UPDATE categories child SET parent_id = parent.id,
    path = 'agriculture/livestock/' || CASE child.code WHEN 'bees' THEN 'bees' ELSE 'queen-bees' END,
    updated_at = now()
FROM categories parent
WHERE child.code IN ('bees', 'queen_bees') AND parent.code = 'livestock';
UPDATE categories SET name = 'Бджолині сім’ї та бджолопакети', updated_at = now()
WHERE code = 'bees';
