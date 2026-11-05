ALTER TABLE offers ADD COLUMN request_key uuid;
ALTER TABLE offers ADD COLUMN request_fingerprint text;
CREATE UNIQUE INDEX offers_seller_request_key ON offers (seller_id, request_key) WHERE request_key IS NOT NULL;
