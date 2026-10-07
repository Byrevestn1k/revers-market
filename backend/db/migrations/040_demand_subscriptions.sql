CREATE TABLE demand_subscriptions (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id uuid NOT NULL REFERENCES categories(id),
    region text,
    active boolean NOT NULL DEFAULT true,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT demand_subscription_region CHECK (region IS NULL OR char_length(region) BETWEEN 1 AND 160)
);

CREATE INDEX demand_subscriptions_owner_idx ON demand_subscriptions (user_id, created_at DESC, id DESC);
CREATE INDEX demand_subscriptions_match_idx ON demand_subscriptions (category_id, region) WHERE active;

-- Keep delivered notifications after a subscription is deleted.
ALTER TABLE notifications ADD COLUMN demand_subscription_id uuid REFERENCES demand_subscriptions(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX notifications_demand_request_unique
    ON notifications (demand_subscription_id, buy_request_id)
    WHERE demand_subscription_id IS NOT NULL;
