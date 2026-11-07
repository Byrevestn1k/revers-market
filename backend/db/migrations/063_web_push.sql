CREATE TABLE push_subscriptions (
    endpoint text PRIMARY KEY,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    session_hash text NOT NULL REFERENCES user_sessions(token_hash) ON DELETE CASCADE,
    p256dh text NOT NULL,
    auth text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX push_subscriptions_user_idx ON push_subscriptions (user_id);
CREATE INDEX push_subscriptions_session_idx ON push_subscriptions (session_hash);

-- Notification rows and this delivery marker commit or roll back together.
CREATE TABLE push_outbox (
    notification_id uuid PRIMARY KEY REFERENCES notifications(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    claimed_at timestamptz
);
CREATE INDEX push_outbox_pending_idx ON push_outbox (created_at) WHERE claimed_at IS NULL;
CREATE FUNCTION enqueue_push_notification() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF (NEW.type = 'message' AND NEW.conversation_id IS NOT NULL)
       OR (NEW.type = 'order' AND NEW.title = 'Нова пропозиція' AND NEW.buy_request_id IS NOT NULL AND NEW.offer_id IS NOT NULL) THEN
        INSERT INTO push_outbox (notification_id) VALUES (NEW.id);
    END IF;
    RETURN NEW;
END;
$$;
CREATE TRIGGER notifications_enqueue_push AFTER INSERT ON notifications
FOR EACH ROW EXECUTE FUNCTION enqueue_push_notification();
