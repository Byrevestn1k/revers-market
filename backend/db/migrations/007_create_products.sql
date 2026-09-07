CREATE TABLE products (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories(id),
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    quantity numeric(14, 3) NOT NULL,
    unit text NOT NULL,
    price numeric(14, 2) NOT NULL,
    currency text NOT NULL,
    delivery_mode text NOT NULL,
    geo_zone text NOT NULL,
    latitude numeric(9, 6),
    longitude numeric(9, 6),
    status text NOT NULL DEFAULT 'draft',
    expires_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT products_title_length CHECK (char_length(title) BETWEEN 2 AND 160),
    CONSTRAINT products_description_length CHECK (char_length(description) <= 5000),
    CONSTRAINT products_quantity_positive CHECK (quantity > 0),
    CONSTRAINT products_price_non_negative CHECK (price >= 0),
    CONSTRAINT products_currency_format CHECK (currency ~ '^[A-Z]{3}$'),
    CONSTRAINT products_delivery_mode CHECK (delivery_mode IN ('pickup', 'seller_delivery', 'carrier')),
    CONSTRAINT products_status CHECK (status IN ('draft', 'active', 'paused', 'sold', 'expired')),
    CONSTRAINT products_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    CONSTRAINT products_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180)
);

CREATE TABLE product_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    storage_key text NOT NULL,
    url text NOT NULL,
    alt text NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT product_photos_alt_length CHECK (char_length(alt) <= 200),
    CONSTRAINT product_photos_sort_order_non_negative CHECK (sort_order >= 0)
);

CREATE INDEX products_owner_idx ON products (owner_id, updated_at DESC);
CREATE INDEX products_public_list_idx ON products (status, created_at DESC) WHERE status = 'active';
CREATE INDEX products_category_idx ON products (category_id, status);
CREATE INDEX product_photos_product_idx ON product_photos (product_id, sort_order);
