ALTER TABLE notifications ADD COLUMN offer_id uuid REFERENCES offers(id) ON DELETE SET NULL;
