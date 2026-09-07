CREATE TABLE users (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    username text NOT NULL,
    username_normalized text NOT NULL UNIQUE,
    country_code char(2) NOT NULL,
    phone text NOT NULL UNIQUE,
    password_hash text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_username_length CHECK (char_length(username) BETWEEN 3 AND 32),
    CONSTRAINT users_country_code_format CHECK (country_code ~ '^[A-Z]{2}$'),
    CONSTRAINT users_phone_format CHECK (phone ~ '^\\+?[1-9][0-9]{6,14}$')
);

CREATE TABLE user_sessions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash text NOT NULL UNIQUE,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz
);

CREATE INDEX user_sessions_user_id_idx ON user_sessions (user_id);
CREATE INDEX user_sessions_active_idx ON user_sessions (token_hash, expires_at)
    WHERE revoked_at IS NULL;