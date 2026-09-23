ALTER TABLE products
    ADD COLUMN map_location_mode text NOT NULL DEFAULT 'profile'
        CHECK (map_location_mode IN ('profile', 'pin', 'address', 'approximate'));

ALTER TABLE buy_requests
    ADD COLUMN map_location_mode text NOT NULL DEFAULT 'approximate'
        CHECK (map_location_mode IN ('profile', 'pin', 'address', 'approximate'));
