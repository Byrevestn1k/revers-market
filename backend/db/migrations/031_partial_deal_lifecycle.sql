-- A request may be fulfilled by one seller or by several partial deals.
-- Keep the old fulfilled_quantity as a compatibility field, but derive it
-- from actually completed deals in the new workflow.
ALTER TABLE buy_requests ADD COLUMN IF NOT EXISTS selected_quantity numeric(19, 4) NOT NULL DEFAULT 0;
ALTER TABLE buy_requests ADD COLUMN IF NOT EXISTS completed_quantity numeric(19, 4) NOT NULL DEFAULT 0;
ALTER TABLE buy_requests ADD COLUMN IF NOT EXISTS closed_at timestamptz;

ALTER TABLE orders ADD COLUMN IF NOT EXISTS offer_id uuid REFERENCES offers(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS failure_reason text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS buyer_completed_at timestamptz;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS seller_completed_at timestamptz;

UPDATE orders o SET offer_id = oi.offer_id
FROM order_items oi
WHERE oi.order_id = o.id AND o.offer_id IS NULL AND oi.offer_id IS NOT NULL;

-- Existing orders keep working. Their active quantities are reserved and their
-- completed quantities are counted as completed rather than discarded.
UPDATE buy_requests r SET
    selected_quantity = COALESCE((SELECT SUM(o.quantity) FROM orders o
        WHERE o.buy_request_id = r.id AND o.status IN ('accepted', 'in_progress')), 0),
    completed_quantity = COALESCE((SELECT SUM(o.quantity) FROM orders o
        WHERE o.buy_request_id = r.id AND o.status = 'completed'), 0);
UPDATE buy_requests SET fulfilled_quantity = completed_quantity;

ALTER TABLE buy_requests DROP CONSTRAINT IF EXISTS buy_requests_status_matches_quantity;
ALTER TABLE buy_requests DROP CONSTRAINT IF EXISTS buy_requests_status;
ALTER TABLE buy_requests ADD CONSTRAINT buy_requests_status CHECK (status IN (
    'open', 'partially_selected', 'partially_completed', 'completed',
    'fulfilled', 'partially_fulfilled', 'cancelled', 'expired'
));
ALTER TABLE buy_requests ADD CONSTRAINT buy_requests_quantities_valid CHECK (
    requested_quantity > 0 AND selected_quantity >= 0 AND completed_quantity >= 0
    AND selected_quantity + completed_quantity <= requested_quantity
);

ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_status;
ALTER TABLE orders ADD CONSTRAINT orders_status CHECK (status IN (
    'draft', 'active', 'offer_received', 'accepted', 'selected', 'in_progress',
    'buyer_marked_completed', 'seller_marked_completed', 'completed', 'failed',
    'cancelled', 'rejected', 'expired', 'disputed'
));
ALTER TABLE orders ADD CONSTRAINT orders_failure_reason_length CHECK (
    failure_reason IS NULL OR char_length(failure_reason) BETWEEN 3 AND 1000
);

CREATE INDEX IF NOT EXISTS orders_offer_idx ON orders (offer_id) WHERE offer_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_request_status_idx ON orders (buy_request_id, status);
