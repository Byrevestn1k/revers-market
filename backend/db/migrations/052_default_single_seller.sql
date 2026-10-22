-- Existing requests retain their mode. Only future inserts without an explicit mode change.
ALTER TABLE buy_requests ALTER COLUMN fulfillment_mode SET DEFAULT 'single_seller';
