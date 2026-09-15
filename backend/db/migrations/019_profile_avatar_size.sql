ALTER TABLE users DROP CONSTRAINT IF EXISTS users_avatar_url_length;
ALTER TABLE users ADD CONSTRAINT users_avatar_url_length CHECK (avatar_url IS NULL OR char_length(avatar_url) <= 2000000);
