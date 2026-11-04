ALTER TABLE notifications ADD COLUMN direct_proposal_id uuid REFERENCES direct_product_proposals(id) ON DELETE SET NULL;
