ALTER TABLE products ADD COLUMN pickup_address text
    CHECK (pickup_address IS NULL OR char_length(pickup_address) <= 500);
