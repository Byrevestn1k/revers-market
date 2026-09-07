ALTER TABLE buy_requests
    ADD COLUMN latitude numeric(9, 6),
    ADD COLUMN longitude numeric(9, 6);

ALTER TABLE buy_requests
    ADD CONSTRAINT buy_requests_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
    ADD CONSTRAINT buy_requests_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180);

CREATE INDEX buy_requests_geo_idx ON buy_requests (status, latitude, longitude)
    WHERE status IN ('open', 'partially_fulfilled') AND latitude IS NOT NULL AND longitude IS NOT NULL;