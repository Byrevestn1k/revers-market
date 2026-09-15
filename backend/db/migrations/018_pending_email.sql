ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email text;
ALTER TABLE users ADD COLUMN IF NOT EXISTS pending_email_normalized text;
CREATE UNIQUE INDEX IF NOT EXISTS users_pending_email_normalized_key
  ON users (pending_email_normalized) WHERE pending_email_normalized IS NOT NULL;
