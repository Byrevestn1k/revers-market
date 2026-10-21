CREATE TABLE category_appeals (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('product', 'buy_request')),
    target_id uuid,
    category_id uuid NOT NULL REFERENCES categories(id),
    title text NOT NULL CHECK (char_length(title) BETWEEN 2 AND 160),
    description text NOT NULL DEFAULT '' CHECK (char_length(description) <= 5000),
    comment text NOT NULL DEFAULT '' CHECK (char_length(comment) <= 2000),
    status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX category_appeals_user_idx ON category_appeals (user_id, created_at DESC);
CREATE INDEX category_appeals_open_idx ON category_appeals (created_at DESC) WHERE status = 'open';
CREATE UNIQUE INDEX category_appeals_repeat_idx ON category_appeals (user_id, target_type, category_id, md5(lower(title)), md5(lower(description))) WHERE status IN ('open', 'under_review');
