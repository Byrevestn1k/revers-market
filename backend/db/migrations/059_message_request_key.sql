-- Optional client key makes a retry safe without changing historical messages.
ALTER TABLE messages ADD COLUMN request_key uuid;
CREATE UNIQUE INDEX messages_sender_request_key ON messages (conversation_id, sender_id, request_key) WHERE request_key IS NOT NULL;
