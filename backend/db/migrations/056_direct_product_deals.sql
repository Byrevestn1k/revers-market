ALTER TABLE orders ALTER COLUMN buy_request_id DROP NOT NULL;
ALTER TABLE orders ADD COLUMN source text NOT NULL DEFAULT 'buy_request' CHECK (source IN ('buy_request', 'direct_product'));
ALTER TABLE orders ADD CONSTRAINT orders_source_request CHECK ((source = 'buy_request' AND buy_request_id IS NOT NULL) OR (source = 'direct_product' AND buy_request_id IS NULL));

CREATE TABLE direct_product_proposals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    request_key uuid NOT NULL,
    parent_id uuid REFERENCES direct_product_proposals(id),
    unit_price numeric(19,4) NOT NULL CHECK (unit_price >= 0),
    quantity numeric(14,3) NOT NULL CHECK (quantity > 0),
    delivery text NOT NULL CHECK (delivery IN ('SELF_PICKUP','SELLER_DELIVERY','POSTAL_DELIVERY')),
    postal_operator text CHECK (postal_operator IN ('NOVA_POSHTA','UKRPOSHTA')),
    delivery_price numeric(19,4) NOT NULL CHECK (delivery_price >= 0),
    comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 1000),
    product_terms jsonb NOT NULL,
    status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','countered','accepted','rejected','withdrawn','expired')),
    order_id uuid UNIQUE REFERENCES orders(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    responded_at timestamptz,
    UNIQUE (created_by, request_key),
    CHECK ((delivery = 'POSTAL_DELIVERY') = (postal_operator IS NOT NULL))
);
CREATE UNIQUE INDEX direct_product_one_pending ON direct_product_proposals(conversation_id) WHERE status = 'pending';
CREATE INDEX direct_product_proposal_history ON direct_product_proposals(conversation_id, created_at, id);
