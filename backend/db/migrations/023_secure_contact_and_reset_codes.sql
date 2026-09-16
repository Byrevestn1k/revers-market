ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_phone_country_code char(2);
ALTER TABLE users ADD COLUMN IF NOT EXISTS phone_verification_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_grant_hash text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_reset_grant_expires timestamptz;
