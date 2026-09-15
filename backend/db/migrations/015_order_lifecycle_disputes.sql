-- Двостороннє підтвердження, причина скасування та спори
ALTER TABLE orders DROP CONSTRAINT orders_status;
ALTER TABLE orders ADD CONSTRAINT orders_status CHECK (status IN ('draft', 'active', 'offer_received', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected', 'expired', 'disputed'));

ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancel_reason text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_cancel_reason_length;
ALTER TABLE orders ADD CONSTRAINT orders_cancel_reason_length CHECK (cancel_reason IS NULL OR char_length(cancel_reason) BETWEEN 3 AND 1000);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS cancelled_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispute_reason text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_dispute_reason_length;
ALTER TABLE orders ADD CONSTRAINT orders_dispute_reason_length CHECK (dispute_reason IS NULL OR char_length(dispute_reason) BETWEEN 5 AND 2000);
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispute_status text;
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_dispute_status;
ALTER TABLE orders ADD CONSTRAINT orders_dispute_status CHECK (dispute_status IS NULL OR dispute_status IN ('open', 'resolved', 'dismissed'));
ALTER TABLE orders ADD COLUMN IF NOT EXISTS dispute_resolution text;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS resolved_by uuid REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE orders ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

CREATE INDEX IF NOT EXISTS orders_dispute_status_idx ON orders (dispute_status, updated_at DESC) WHERE dispute_status = 'open';
