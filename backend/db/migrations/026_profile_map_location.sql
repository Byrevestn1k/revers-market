ALTER TABLE users
    ADD COLUMN map_location_mode text NOT NULL DEFAULT 'approximate'
        CHECK (map_location_mode IN ('approximate', 'address', 'pin')),
    ADD COLUMN public_latitude numeric(9,6),
    ADD COLUMN public_longitude numeric(9,6),
    ADD CONSTRAINT profile_public_point_valid CHECK (
        (map_location_mode = 'approximate' AND public_latitude IS NULL AND public_longitude IS NULL)
        OR (map_location_mode IN ('address', 'pin') AND public_latitude IS NOT NULL AND public_longitude IS NOT NULL
            AND public_latitude BETWEEN -90 AND 90 AND public_longitude BETWEEN -180 AND 180)
    );
