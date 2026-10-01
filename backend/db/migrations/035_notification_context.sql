ALTER TABLE notifications
    ADD COLUMN context text NULL,
    ADD COLUMN buy_request_id uuid NULL REFERENCES buy_requests(id) ON DELETE SET NULL,
    ADD CONSTRAINT notifications_context_check CHECK (context IN ('buying', 'selling'));

CREATE INDEX notifications_user_context_created_idx ON notifications (user_id, context, created_at DESC);

-- Only derive legacy context where the existing structured relation proves it.
UPDATE notifications n
SET context = COALESCE(
    (SELECT CASE WHEN o.buyer_id = n.user_id THEN 'buying' WHEN o.seller_id = n.user_id THEN 'selling' END FROM orders o WHERE o.id = n.order_id),
    (SELECT CASE WHEN cp.role = 'buyer' THEN 'buying' WHEN cp.role = 'seller' THEN 'selling' END FROM conversation_participants cp WHERE cp.conversation_id = n.conversation_id AND cp.user_id = n.user_id)
),
buy_request_id = COALESCE(
    (SELECT o.buy_request_id FROM orders o WHERE o.id = n.order_id),
    (SELECT COALESCE(offer.buy_request_id, c.buy_request_id) FROM conversations c LEFT JOIN offers offer ON offer.id = c.offer_id WHERE c.id = n.conversation_id)
)
WHERE n.context IS NULL
  AND (n.order_id IS NOT NULL OR n.conversation_id IS NOT NULL);
