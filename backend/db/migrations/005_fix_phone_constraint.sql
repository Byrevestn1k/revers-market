ALTER TABLE users DROP CONSTRAINT users_phone_format;
ALTER TABLE users ADD CONSTRAINT users_phone_format CHECK (phone ~ '^\+?[1-9][0-9]{6,14}$');