ALTER TABLE buy_requests
    ADD COLUMN country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
    ADD COLUMN receipt_method text CHECK (receipt_method IS NULL OR receipt_method IN ('SELF_PICKUP', 'SELLER_DELIVERY'));

-- Settlement identity comes from the Ukrainian directory. Do not guess legacy free text.
UPDATE buy_requests SET country_code = 'UA' WHERE settlement_code IS NOT NULL;
UPDATE buy_requests SET receipt_method = CASE
    WHEN preferred_delivery = 'pickup' AND NOT delivery_required THEN 'SELF_PICKUP'
    WHEN preferred_delivery = 'seller_delivery' THEN 'SELLER_DELIVERY'
    ELSE NULL END;

ALTER TABLE demand_subscriptions
    ADD COLUMN country_code text CHECK (country_code IS NULL OR country_code ~ '^[A-Z]{2}$'),
    ADD COLUMN settlement_codes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN center_latitude numeric,
    ADD COLUMN center_longitude numeric,
    ADD COLUMN radius_km numeric,
    ADD COLUMN min_quantity numeric(19,4),
    ADD COLUMN max_quantity numeric(19,4),
    ADD COLUMN unit text,
    ADD COLUMN min_price numeric(19,4),
    ADD COLUMN max_price numeric(19,4),
    ADD COLUMN currency text CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
    ADD COLUMN receipt_methods text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT subscription_cities_limit CHECK (cardinality(settlement_codes) <= 30),
    ADD CONSTRAINT subscription_radius CHECK (
        (radius_km IS NULL AND center_latitude IS NULL AND center_longitude IS NULL) OR
        (radius_km IS NOT NULL AND center_latitude IS NOT NULL AND center_longitude IS NOT NULL
            AND radius_km BETWEEN 0.2 AND 200 AND center_latitude BETWEEN -90 AND 90 AND center_longitude BETWEEN -180 AND 180)),
    ADD CONSTRAINT subscription_quantity CHECK ((min_quantity IS NULL OR min_quantity > 0)
        AND (max_quantity IS NULL OR max_quantity > 0) AND (min_quantity IS NULL OR max_quantity IS NULL OR min_quantity <= max_quantity)),
    ADD CONSTRAINT subscription_price CHECK ((min_price IS NULL OR min_price >= 0)
        AND (max_price IS NULL OR max_price >= 0) AND (min_price IS NULL OR max_price IS NULL OR min_price <= max_price)),
    ADD CONSTRAINT subscription_unit CHECK (unit IS NULL OR unit IN ('kg','ton','litre','piece','box')),
    ADD CONSTRAINT subscription_quantity_unit CHECK ((min_quantity IS NULL AND max_quantity IS NULL) OR unit IS NOT NULL),
    ADD CONSTRAINT subscription_price_unit_currency CHECK ((min_price IS NULL AND max_price IS NULL) OR (unit IS NOT NULL AND currency IS NOT NULL)),
    ADD CONSTRAINT subscription_receipt_methods CHECK (receipt_methods <@ ARRAY['SELF_PICKUP','SELLER_DELIVERY']::text[]);

-- Previous Step 8 UI offered all Ukraine or an Ukrainian oblast.
UPDATE demand_subscriptions SET country_code = 'UA';
ALTER TABLE demand_subscriptions ADD CONSTRAINT subscription_geography_required
    CHECK (country_code IS NOT NULL OR region IS NOT NULL OR cardinality(settlement_codes) > 0);
