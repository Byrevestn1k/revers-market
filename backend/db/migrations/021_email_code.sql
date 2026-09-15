ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_verification_code_expires timestamptz;
