ALTER TABLE orders DROP CONSTRAINT orders_status;
UPDATE orders SET status = 'accepted' WHERE status IN ('pending', 'confirmed');
UPDATE orders SET status = 'completed' WHERE status = 'delivered';
ALTER TABLE orders ADD CONSTRAINT orders_status CHECK (status IN ('draft', 'active', 'offer_received', 'accepted', 'in_progress', 'completed', 'cancelled', 'rejected', 'expired'));
ALTER TABLE orders ADD COLUMN quantity numeric(19, 4);
ALTER TABLE orders ADD COLUMN unit text;
ALTER TABLE orders ADD COLUMN unit_price numeric(19, 4);
ALTER TABLE orders ADD COLUMN conditions_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE orders ALTER COLUMN status SET DEFAULT 'accepted';
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_quantity_valid;
ALTER TABLE orders ADD CONSTRAINT orders_quantity_valid CHECK (quantity IS NULL OR quantity > 0);
ALTER TABLE orders DROP CONSTRAINT IF EXISTS orders_unit_price_valid;
ALTER TABLE orders ADD CONSTRAINT orders_unit_price_valid CHECK (unit_price IS NULL OR unit_price >= 0);
DROP INDEX IF EXISTS orders_request_seller_idx;

CREATE TABLE conversations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE conversation_participants (
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role text NOT NULL,
    last_read_at timestamptz,
    joined_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (conversation_id, user_id),
    CONSTRAINT conversation_participant_role CHECK (role IN ('buyer', 'seller'))
);

CREATE TABLE messages (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
    sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    body text NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT message_body_length CHECK (char_length(btrim(body)) BETWEEN 1 AND 5000)
);

CREATE INDEX conversation_participants_user_idx ON conversation_participants (user_id, conversation_id);
CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at, id);

CREATE OR REPLACE FUNCTION prevent_conversation_message_sender() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM conversation_participants WHERE conversation_id = NEW.conversation_id AND user_id = NEW.sender_id) THEN
        RAISE EXCEPTION 'message sender is not a conversation participant';
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER messages_participant_guard BEFORE INSERT OR UPDATE ON messages
FOR EACH ROW EXECUTE FUNCTION prevent_conversation_message_sender();