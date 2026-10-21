CREATE TABLE category_block_decisions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type text NOT NULL CHECK (target_type IN ('product', 'buy_request')),
    target_id uuid,
    category_id uuid NOT NULL REFERENCES categories(id),
    title text NOT NULL,
    description text NOT NULL DEFAULT '',
    reason text NOT NULL,
    rules_version text NOT NULL,
    status text NOT NULL DEFAULT 'blocked' CHECK (status IN ('blocked', 'appealed', 'resolved', 'dismissed')),
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX category_block_decisions_user_recent_idx ON category_block_decisions (user_id, created_at DESC);
ALTER TABLE category_appeals ADD COLUMN decision_id uuid REFERENCES category_block_decisions(id);
CREATE UNIQUE INDEX category_appeals_decision_idx ON category_appeals (decision_id) WHERE decision_id IS NOT NULL;
