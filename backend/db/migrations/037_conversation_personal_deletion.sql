-- Personal removal hides a conversation only for one participant. Shared
-- conversations and messages remain available to the counterpart.
ALTER TABLE conversation_participants
    ADD COLUMN deleted_at timestamptz NULL;

CREATE INDEX conversation_participants_deleted_idx
    ON conversation_participants (user_id, deleted_at DESC)
    WHERE deleted_at IS NOT NULL;
