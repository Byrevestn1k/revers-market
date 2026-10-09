-- Multiple selections from the existing single territory picker.
ALTER TABLE demand_subscriptions
    ADD COLUMN country_codes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN regions text[] NOT NULL DEFAULT '{}',
    ADD CONSTRAINT subscription_countries_shape CHECK (cardinality(country_codes) <= 30 AND array_position(country_codes, NULL) IS NULL AND (cardinality(country_codes) = 0 OR array_to_string(country_codes, ',') ~ '^([A-Z]{2})(,[A-Z]{2})*$')),
    ADD CONSTRAINT subscription_regions_shape CHECK (cardinality(regions) <= 30 AND array_position(regions, NULL) IS NULL);

-- Retain scalar fields for existing clients and preserve all saved selections.
UPDATE demand_subscriptions SET country_codes = CASE WHEN country_code IS NULL THEN '{}'::text[] ELSE ARRAY[country_code] END,
    regions = CASE WHEN region IS NULL THEN '{}'::text[] ELSE ARRAY[region] END;

-- The requested suburb limit is 20 km. Existing larger selections are capped.
UPDATE demand_subscriptions SET city_outside_km = 20 WHERE city_outside_km > 20;
ALTER TABLE demand_subscriptions DROP CONSTRAINT subscription_city_outside;
ALTER TABLE demand_subscriptions ADD CONSTRAINT subscription_city_outside CHECK
    (city_outside_km IS NULL OR (city_outside_km BETWEEN 0 AND 20 AND cardinality(settlement_codes) > 0));
