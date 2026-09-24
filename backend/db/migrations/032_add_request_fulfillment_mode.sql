-- Existing requests already support partial fulfilment, so preserve that
-- behaviour explicitly when introducing the buyer's choice for new requests.
ALTER TABLE buy_requests ADD COLUMN IF NOT EXISTS fulfillment_mode text;
UPDATE buy_requests SET fulfillment_mode = 'multiple_sellers' WHERE fulfillment_mode IS NULL;
ALTER TABLE buy_requests ALTER COLUMN fulfillment_mode SET NOT NULL;
ALTER TABLE buy_requests ALTER COLUMN fulfillment_mode SET DEFAULT 'multiple_sellers';
ALTER TABLE buy_requests DROP CONSTRAINT IF EXISTS buy_requests_fulfillment_mode;
ALTER TABLE buy_requests ADD CONSTRAINT buy_requests_fulfillment_mode CHECK (fulfillment_mode IN ('single_seller', 'multiple_sellers'));
CREATE INDEX IF NOT EXISTS buy_requests_fulfillment_mode_idx ON buy_requests (fulfillment_mode);
