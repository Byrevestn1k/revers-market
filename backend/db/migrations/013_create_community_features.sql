CREATE TABLE notifications (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    type text NOT NULL,
    title text NOT NULL,
    body text NOT NULL DEFAULT '',
    order_id uuid NULL REFERENCES orders(id) ON DELETE CASCADE,
    conversation_id uuid NULL REFERENCES conversations(id) ON DELETE CASCADE,
    read_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT notifications_type CHECK (type IN ('order', 'message', 'review', 'report', 'system')),
    CONSTRAINT notifications_title_length CHECK (char_length(title) BETWEEN 1 AND 160),
    CONSTRAINT notifications_body_length CHECK (char_length(body) <= 2000)
);

CREATE TABLE reviews (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    reviewer_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reviewee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    rating smallint NOT NULL,
    body text NOT NULL DEFAULT '',
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reviews_rating CHECK (rating BETWEEN 1 AND 12),
    CONSTRAINT reviews_not_self CHECK (reviewer_id <> reviewee_id),
    CONSTRAINT reviews_body_length CHECK (char_length(body) <= 2000),
    UNIQUE (order_id, reviewer_id)
);

CREATE TABLE reports (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_type text NOT NULL,
    target_id uuid NOT NULL,
    reason text NOT NULL,
    details text NOT NULL DEFAULT '',
    status text NOT NULL DEFAULT 'open',
    moderator_id uuid REFERENCES users(id) ON DELETE SET NULL,
    moderation_note text,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT reports_target_type CHECK (target_type IN ('user', 'product', 'buy_request', 'order', 'message')),
    CONSTRAINT reports_status CHECK (status IN ('open', 'under_review', 'resolved', 'dismissed')),
    CONSTRAINT reports_reason_length CHECK (char_length(reason) BETWEEN 2 AND 160),
    CONSTRAINT reports_details_length CHECK (char_length(details) <= 5000)
);

CREATE TABLE user_blocks (
    blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (blocker_id, blocked_id),
    CONSTRAINT user_blocks_not_self CHECK (blocker_id <> blocked_id)
);

CREATE TABLE audit_logs (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_id uuid REFERENCES users(id) ON DELETE SET NULL,
    action text NOT NULL,
    entity_type text NOT NULL,
    entity_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX notifications_user_idx ON notifications (user_id, created_at DESC);
CREATE INDEX reviews_reviewee_idx ON reviews (reviewee_id, created_at DESC);
CREATE INDEX reports_status_idx ON reports (status, created_at DESC);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

CREATE OR REPLACE FUNCTION apply_review_rating() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    UPDATE users SET rating_sum = rating_sum + NEW.rating, rating_count = rating_count + 1, updated_at = now()
    WHERE id = NEW.reviewee_id;
    RETURN NEW;
END;
$$;

CREATE TRIGGER reviews_rating_aggregate AFTER INSERT ON reviews
FOR EACH ROW EXECUTE FUNCTION apply_review_rating();