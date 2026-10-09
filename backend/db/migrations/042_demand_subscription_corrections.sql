ALTER TABLE demand_subscriptions
    ADD COLUMN city_outside_km numeric,
    ADD COLUMN settlement_boundaries jsonb NOT NULL DEFAULT '{}'::jsonb,
    ADD CONSTRAINT subscription_city_outside CHECK (city_outside_km IS NULL OR (city_outside_km BETWEEN 0 AND 100 AND cardinality(settlement_codes) > 0)),
    ADD CONSTRAINT subscription_boundary_object CHECK (jsonb_typeof(settlement_boundaries) = 'object');

-- An old unrestricted subscription remains unrestricted with both available methods.
UPDATE demand_subscriptions SET receipt_methods = ARRAY['SELF_PICKUP','SELLER_DELIVERY']::text[] WHERE cardinality(receipt_methods) = 0;
ALTER TABLE demand_subscriptions
    ALTER COLUMN receipt_methods SET DEFAULT ARRAY['SELF_PICKUP','SELLER_DELIVERY']::text[],
    ADD CONSTRAINT subscription_receipt_required CHECK (cardinality(receipt_methods) BETWEEN 1 AND 2);

-- Previously UA was the enclosing country, also filled implicitly for regions/cities.
-- Keep those narrower saved scopes when country becomes an independent selection.
UPDATE demand_subscriptions SET country_code = NULL WHERE country_code = 'UA' AND (region IS NOT NULL OR cardinality(settlement_codes) > 0);

-- Legacy public-point radius data remains readable until its owner replaces the criteria.
-- It cannot be faithfully converted into distance from a settlement boundary.
