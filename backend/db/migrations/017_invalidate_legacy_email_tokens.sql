-- Earlier development builds stored raw tokens. Invalidate these links rather
-- than accepting unhashed credentials alongside the new SHA-256 format.
UPDATE users
SET email_verification_token = NULL, email_verification_expires = NULL
WHERE email_verification_token IS NOT NULL
  AND email_verification_token !~ '^[0-9a-f]{64}$';

ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_normalized text;
CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_normalized_key
  ON users (pending_email_normalized) WHERE pending_email_normalized IS NOT NULL;
