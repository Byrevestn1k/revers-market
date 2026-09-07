CREATE TABLE buy_requests (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buyer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories(id),
    product_id uuid NULL REFERENCES products(id) ON DELETE SET NULL,
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    requested_quantity numeric(19, 4) NOT NULL,
    fulfilled_quantity numeric(19, 4) NOT NULL DEFAULT 0,
    unit text NOT NULL,
    currency char(3) NOT NULL,
    min_unit_price numeric(19, 4),
    max_unit_price numeric(19, 4),
    delivery_required boolean NOT NULL DEFAULT false,
    preferred_delivery text,
    geo_area text NOT NULL,
    delivery_address text,
    deadline timestamptz,
    status text NOT NULL DEFAULT 'open',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT buy_requests_title_length CHECK (char_length(title) BETWEEN 2 AND 160),
    CONSTRAINT buy_requests_description_length CHECK (char_length(description) <= 5000),
    CONSTRAINT buy_requests_quantity_positive CHECK (requested_quantity > 0),
    CONSTRAINT buy_requests_fulfilled_valid CHECK (fulfilled_quantity >= 0 AND fulfilled_quantity <= requested_quantity),
    CONSTRAINT buy_requests_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT buy_requests_price_range_valid CHECK (min_unit_price IS NULL OR (min_unit_price >= 0 AND (max_unit_price IS NULL OR min_unit_price <= max_unit_price))),
    CONSTRAINT buy_requests_max_price_valid CHECK (max_unit_price IS NULL OR max_unit_price >= 0),
    CONSTRAINT buy_requests_delivery_valid CHECK (delivery_required OR (preferred_delivery IS NULL OR char_length(preferred_delivery) <= 160)),
    CONSTRAINT buy_requests_status CHECK (status IN ('open', 'partially_fulfilled', 'fulfilled', 'cancelled', 'expired'))
);

CREATE TABLE offers (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_request_id uuid NOT NULL REFERENCES buy_requests(id) ON DELETE CASCADE,
    seller_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    product_id uuid NULL REFERENCES products(id) ON DELETE SET NULL,
    offered_quantity numeric(19, 4) NOT NULL,
    accepted_quantity numeric(19, 4) NOT NULL DEFAULT 0,
    unit text NOT NULL,
    unit_price numeric(19, 4) NOT NULL,
    currency char(3) NOT NULL,
    delivery text NOT NULL,
    note text NOT NULL DEFAULT '',
    additional_photo_url text,
    terms jsonb NOT NULL DEFAULT '{}'::jsonb,
    delivery_terms jsonb NOT NULL DEFAULT '{}'::jsonb,
    status text NOT NULL DEFAULT 'submitted',
    valid_until timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT offers_quantity_valid CHECK (offered_quantity > 0 AND accepted_quantity >= 0 AND accepted_quantity <= offered_quantity),
    CONSTRAINT offers_price_valid CHECK (unit_price >= 0),
    CONSTRAINT offers_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT offers_note_length CHECK (char_length(note) <= 5000),
    CONSTRAINT offers_delivery_length CHECK (char_length(delivery) BETWEEN 1 AND 160),
    CONSTRAINT offers_photo_length CHECK (additional_photo_url IS NULL OR char_length(additional_photo_url) <= 2048),
    CONSTRAINT offers_status CHECK (status IN ('draft', 'submitted', 'accepted', 'partially_accepted', 'rejected', 'withdrawn', 'expired'))
);

CREATE TABLE orders (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_request_id uuid NOT NULL REFERENCES buy_requests(id) ON DELETE CASCADE,
    buyer_id uuid NOT NULL REFERENCES users(id),
    seller_id uuid NOT NULL REFERENCES users(id),
    status text NOT NULL DEFAULT 'pending',
    currency char(3) NOT NULL,
    subtotal numeric(19, 4) NOT NULL,
    accepted_at timestamptz NOT NULL DEFAULT now(),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT orders_subtotal_valid CHECK (subtotal >= 0),
    CONSTRAINT orders_status CHECK (status IN ('pending', 'confirmed', 'in_progress', 'delivered', 'cancelled', 'disputed'))
);

CREATE TABLE order_items (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    offer_id uuid NULL REFERENCES offers(id) ON DELETE SET NULL,
    product_id uuid NULL REFERENCES products(id) ON DELETE SET NULL,
    quantity numeric(19, 4) NOT NULL,
    unit text NOT NULL,
    unit_price numeric(19, 4) NOT NULL,
    currency char(3) NOT NULL,
    product_title_snapshot text NOT NULL,
    offer_terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    delivery_terms_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT order_items_quantity_valid CHECK (quantity > 0),
    CONSTRAINT order_items_price_valid CHECK (unit_price >= 0)
);

CREATE INDEX buy_requests_buyer_idx ON buy_requests (buyer_id, updated_at DESC);
CREATE INDEX buy_requests_public_idx ON buy_requests (status, created_at DESC) WHERE status IN ('open', 'partially_fulfilled');
CREATE INDEX offers_request_idx ON offers (buy_request_id, created_at DESC);
CREATE INDEX offers_seller_idx ON offers (seller_id, updated_at DESC);
CREATE UNIQUE INDEX orders_request_seller_idx ON orders (buy_request_id, seller_id);

CREATE OR REPLACE FUNCTION prevent_offer_buyer() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF EXISTS (SELECT 1 FROM buy_requests WHERE id = NEW.buy_request_id AND buyer_id = NEW.seller_id) THEN
        RAISE EXCEPTION 'offer seller cannot be the buyer';
    END IF;
    IF NEW.product_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM products WHERE id = NEW.product_id AND owner_id = NEW.seller_id) THEN
        RAISE EXCEPTION 'offer product does not belong to seller';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER offers_owner_guard BEFORE INSERT OR UPDATE ON offers
FOR EACH ROW EXECUTE FUNCTION prevent_offer_buyer();