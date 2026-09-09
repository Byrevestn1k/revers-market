-- Inventory is committed when an offer is accepted.  Keeping this in the
-- database makes it impossible for concurrent accepts to oversell a listing.
ALTER TABLE products ADD COLUMN reserved_quantity numeric(14, 3) NOT NULL DEFAULT 0;
ALTER TABLE products DROP CONSTRAINT products_quantity_positive;
ALTER TABLE products ADD CONSTRAINT products_quantity_non_negative CHECK (quantity >= 0);
ALTER TABLE products ADD CONSTRAINT products_reserved_quantity_valid CHECK (reserved_quantity >= 0 AND reserved_quantity <= quantity);

-- A conversation can start while the parties negotiate an offer, then remain
-- linked to the order once that offer is accepted.
ALTER TABLE conversations ALTER COLUMN order_id DROP NOT NULL;
ALTER TABLE conversations ADD COLUMN offer_id uuid UNIQUE REFERENCES offers(id) ON DELETE SET NULL;
CREATE INDEX conversations_offer_idx ON conversations (offer_id) WHERE offer_id IS NOT NULL;

-- Do not allow a request to claim completion independently from accepted quantity.
ALTER TABLE buy_requests ADD CONSTRAINT buy_requests_status_matches_quantity CHECK (
  (status = 'fulfilled' AND fulfilled_quantity = requested_quantity)
  OR (status <> 'fulfilled')
);
