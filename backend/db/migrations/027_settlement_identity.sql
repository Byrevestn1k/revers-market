-- Nullable identities preserve existing addresses. Never guess codes from names.
ALTER TABLE products ADD COLUMN settlement_code text;
ALTER TABLE buy_requests ADD COLUMN settlement_code text;
ALTER TABLE users ADD COLUMN settlement_code text;
ALTER TABLE users ADD COLUMN address_settlement_code text;
ALTER TABLE users ADD COLUMN address_latitude double precision;
ALTER TABLE users ADD COLUMN address_longitude double precision;
ALTER TABLE users ADD CONSTRAINT users_address_coordinates CHECK (
    (address_latitude IS NULL AND address_longitude IS NULL) OR
    (address_latitude IS NOT NULL AND address_longitude IS NOT NULL AND address_latitude BETWEEN -90 AND 90 AND address_longitude BETWEEN -180 AND 180)
);
CREATE INDEX products_settlement_code_idx ON products (settlement_code);
CREATE INDEX buy_requests_settlement_code_idx ON buy_requests (settlement_code);
