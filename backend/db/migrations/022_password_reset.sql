ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_code text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_expires timestamptz;
