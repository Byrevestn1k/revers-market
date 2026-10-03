-- Personal conversation organisation. These values belong to one participant,
-- never to the shared conversation or its messages.
ALTER TABLE conversation_participants
    ADD COLUMN pinned_at timestamptz NULL,
    ADD COLUMN archived_at timestamptz NULL;

CREATE INDEX conversation_participants_pinned_idx
    ON conversation_participants (user_id, pinned_at DESC)
    WHERE pinned_at IS NOT NULL;

CREATE INDEX conversation_participants_archived_idx
    ON conversation_participants (user_id, archived_at DESC)
    WHERE archived_at IS NOT NULL;
