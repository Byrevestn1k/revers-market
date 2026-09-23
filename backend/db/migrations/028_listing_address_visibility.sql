ALTER TABLE products
    ADD COLUMN address_visibility text NOT NULL DEFAULT 'private'
        CHECK (address_visibility IN ('private', 'public')),
    ADD CONSTRAINT products_public_address_requires_location CHECK (
        address_visibility = 'private'
        OR (pickup_address IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL)
    );

ALTER TABLE buy_requests
    ADD COLUMN address_visibility text NOT NULL DEFAULT 'private'
        CHECK (address_visibility IN ('private', 'public')),
    ADD CONSTRAINT buy_requests_public_address_requires_location CHECK (
        address_visibility = 'private'
        OR (delivery_address IS NOT NULL AND latitude IS NOT NULL AND longitude IS NOT NULL)
    );
