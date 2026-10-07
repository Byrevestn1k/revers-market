ALTER TABLE external_auth_flows
    ADD COLUMN origin_page text NOT NULL DEFAULT 'login'
    CHECK (origin_page IN ('login', 'register', 'settings', 'confirm'));
