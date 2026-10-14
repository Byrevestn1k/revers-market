CREATE TABLE buy_request_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    buy_request_id uuid NOT NULL REFERENCES buy_requests(id) ON DELETE CASCADE,
    storage_key text NOT NULL,
    url text NOT NULL,
    alt text NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT buy_request_photos_alt_length CHECK (char_length(alt) <= 200),
    CONSTRAINT buy_request_photos_sort_order_non_negative CHECK (sort_order >= 0)
);

CREATE INDEX buy_request_photos_request_idx ON buy_request_photos (buy_request_id, sort_order, id);
