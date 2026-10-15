ALTER TABLE offers ADD COLUMN title text;
ALTER TABLE offers ADD COLUMN description text NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN characteristics text NOT NULL DEFAULT '';
ALTER TABLE offers ADD COLUMN creation_mode text;
ALTER TABLE offers ADD CONSTRAINT offers_title_length CHECK (title IS NULL OR char_length(title) BETWEEN 2 AND 160);
ALTER TABLE offers ADD CONSTRAINT offers_description_length CHECK (char_length(description) <= 5000);
ALTER TABLE offers ADD CONSTRAINT offers_characteristics_length CHECK (char_length(characteristics) <= 3000);
ALTER TABLE offers ADD CONSTRAINT offers_creation_mode CHECK (creation_mode IS NULL OR creation_mode IN ('product', 'manual', 'request_terms'));

CREATE TABLE offer_photos (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    offer_id uuid NOT NULL REFERENCES offers(id) ON DELETE CASCADE,
    storage_key text NOT NULL,
    url text NOT NULL,
    alt text NOT NULL DEFAULT '',
    sort_order integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT offer_photos_alt_length CHECK (char_length(alt) <= 200),
    CONSTRAINT offer_photos_sort_order_non_negative CHECK (sort_order >= 0)
);
CREATE INDEX offer_photos_offer_idx ON offer_photos (offer_id, sort_order, id);
