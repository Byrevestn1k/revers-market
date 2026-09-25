-- A first contact may start from a published product or buy request before an offer exists.
ALTER TABLE conversations ADD COLUMN product_id uuid NULL REFERENCES products(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN buy_request_id uuid NULL REFERENCES buy_requests(id) ON DELETE SET NULL;

CREATE INDEX conversations_product_idx ON conversations(product_id) WHERE product_id IS NOT NULL;
CREATE INDEX conversations_buy_request_idx ON conversations(buy_request_id) WHERE buy_request_id IS NOT NULL;
