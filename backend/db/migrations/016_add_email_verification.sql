ALTER TABLE users
    ADD COLUMN email text,
    ADD COLUMN email_normalized text,
    ADD COLUMN email_verified boolean NOT NULL DEFAULT false,
    ADD COLUMN email_verification_token text,
    ADD COLUMN email_verification_expires timestamptz;

-- унікальність пошти (порожні NULL допускаються)
CREATE UNIQUE INDEX users_email_normalized_key ON users (email_normalized) WHERE email_normalized IS NOT NULL;

ALTER TABLE users
    ADD CONSTRAINT users_email_format CHECK (email IS NULL OR email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
