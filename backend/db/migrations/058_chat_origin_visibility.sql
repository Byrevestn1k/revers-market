-- Only newly created profile conversations are explicitly direct. Historical
-- unlinked conversations remain unknown rather than being guessed as direct.
ALTER TABLE conversations ADD COLUMN profile_user_low uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD COLUMN profile_user_high uuid REFERENCES users(id) ON DELETE CASCADE;
ALTER TABLE conversations ADD CONSTRAINT conversation_profile_pair CHECK (
    (profile_user_low IS NULL AND profile_user_high IS NULL) OR
    (profile_user_low IS NOT NULL AND profile_user_high IS NOT NULL AND profile_user_low < profile_user_high
     AND order_id IS NULL AND offer_id IS NULL AND product_id IS NULL AND buy_request_id IS NULL)
);
CREATE UNIQUE INDEX conversations_profile_pair ON conversations(profile_user_low, profile_user_high)
    WHERE profile_user_low IS NOT NULL;

-- A personal deletion hides existing messages without modifying shared history.
ALTER TABLE conversation_participants ADD COLUMN history_hidden_before timestamptz;
UPDATE conversation_participants SET history_hidden_before = deleted_at WHERE deleted_at IS NOT NULL;
