ALTER TABLE push_subscriptions ADD COLUMN binding_id uuid NOT NULL DEFAULT gen_random_uuid();
CREATE UNIQUE INDEX push_subscriptions_binding_idx ON push_subscriptions (binding_id);
