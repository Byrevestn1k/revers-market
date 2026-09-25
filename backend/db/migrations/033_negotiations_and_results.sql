-- Extend the existing orders, conversations and reviews; preserve historic records.
ALTER TABLE orders ADD COLUMN workflow_version integer NOT NULL DEFAULT 1;
UPDATE orders SET workflow_version = 2 WHERE status IN ('selected', 'buyer_marked_completed', 'seller_marked_completed');
ALTER TABLE orders ALTER COLUMN workflow_version SET DEFAULT 2;
ALTER TABLE orders ADD COLUMN selection_key uuid;
CREATE UNIQUE INDEX orders_selection_key ON orders (buyer_id, selection_key) WHERE selection_key IS NOT NULL;
ALTER TABLE orders ADD COLUMN seller_confirmed_at timestamptz;
ALTER TABLE orders ADD COLUMN actual_quantity numeric(19,4);
ALTER TABLE orders ADD COLUMN actual_total numeric(19,4);
ALTER TABLE orders ADD COLUMN buyer_result jsonb;
ALTER TABLE orders ADD COLUMN seller_result jsonb;
ALTER TABLE orders ADD CONSTRAINT orders_actual_quantity CHECK (actual_quantity IS NULL OR (actual_quantity > 0 AND actual_quantity <= quantity));
ALTER TABLE orders ADD CONSTRAINT orders_actual_total CHECK (actual_total IS NULL OR actual_total >= 0);

ALTER TABLE messages ADD COLUMN kind text NOT NULL DEFAULT 'text' CHECK (kind IN ('text','system'));

CREATE TABLE negotiation_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    parent_id uuid REFERENCES negotiation_proposals(id) ON DELETE SET NULL,
    unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
    quantity numeric(19,4) NOT NULL CHECK (quantity > 0),
    delivery text NOT NULL,
    delivery_price numeric(19,4) NOT NULL DEFAULT 0 CHECK (delivery_price >= 0),
    comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','countered','withdrawn','expired')),
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz
);
CREATE UNIQUE INDEX negotiation_one_pending ON negotiation_proposals (offer_id) WHERE status = 'pending';
CREATE INDEX negotiation_history ON negotiation_proposals (conversation_id, created_at);
ALTER TABLE orders ADD COLUMN negotiation_proposal_id uuid REFERENCES negotiation_proposals(id) ON DELETE SET NULL;

ALTER TABLE reviews ADD COLUMN published_at timestamptz;
UPDATE reviews SET published_at = created_at;
ALTER TABLE reviews ADD COLUMN publish_after timestamptz NOT NULL DEFAULT (now() + interval '14 days');
ALTER TABLE reviews ADD COLUMN communication_rating smallint CHECK (communication_rating BETWEEN 1 AND 12);
ALTER TABLE reviews ADD COLUMN compliance_rating smallint CHECK (compliance_rating BETWEEN 1 AND 12);
ALTER TABLE reviews ADD COLUMN description_rating smallint CHECK (description_rating BETWEEN 1 AND 12);
CREATE INDEX reviews_due ON reviews (publish_after) WHERE published_at IS NULL;

DROP TRIGGER reviews_rating_aggregate ON reviews;
CREATE OR REPLACE FUNCTION apply_review_rating() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP <> 'INSERT' AND OLD.published_at IS NOT NULL THEN
        UPDATE users SET rating_sum = rating_sum - OLD.rating, rating_count = rating_count - 1 WHERE id = OLD.reviewee_id;
    END IF;
    IF TG_OP <> 'DELETE' AND NEW.published_at IS NOT NULL THEN
        UPDATE users SET rating_sum = rating_sum + NEW.rating, rating_count = rating_count + 1 WHERE id = NEW.reviewee_id;
    END IF;
    RETURN NULL;
END;
$$;
CREATE TRIGGER reviews_rating_aggregate AFTER INSERT OR UPDATE OR DELETE ON reviews
FOR EACH ROW EXECUTE FUNCTION apply_review_rating();

CREATE INDEX audit_logs_action_time ON audit_logs (action, created_at);
