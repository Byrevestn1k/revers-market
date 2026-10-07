ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

CREATE TABLE auth_identities (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    provider text NOT NULL CHECK (provider IN ('google', 'facebook', 'telegram')),
    provider_user_id text NOT NULL,
    provider_email text,
    provider_username text,
    provider_display_name text,
    provider_avatar_url text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    last_used_at timestamptz,
    CONSTRAINT auth_identities_provider_user_unique UNIQUE (provider, provider_user_id),
    CONSTRAINT auth_identities_user_provider_unique UNIQUE (user_id, provider),
    CONSTRAINT auth_identities_provider_user_id_length CHECK (char_length(provider_user_id) BETWEEN 1 AND 255)
);

CREATE INDEX auth_identities_user_id_idx ON auth_identities (user_id);

CREATE TABLE external_auth_flows (
    state_hash text PRIMARY KEY,
    provider text NOT NULL CHECK (provider IN ('google', 'facebook', 'telegram')),
    intent text NOT NULL CHECK (intent IN ('login', 'link', 'signup')),
    user_id uuid REFERENCES users(id) ON DELETE CASCADE,
    session_hash text,
    return_path text NOT NULL,
    code_verifier text,
    nonce text,
    profile jsonb,
    expires_at timestamptz NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT external_auth_flows_link_binding CHECK ((intent = 'link') = (user_id IS NOT NULL AND session_hash IS NOT NULL)),
    CONSTRAINT external_auth_flows_signup_profile CHECK (intent <> 'signup' OR profile IS NOT NULL)
);

CREATE INDEX external_auth_flows_expires_at_idx ON external_auth_flows (expires_at);
