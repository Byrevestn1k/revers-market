-- Visibility is independent of commercial state and quantity accounting.
ALTER TABLE products ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE products ADD COLUMN moderation_version integer NOT NULL DEFAULT 0;
ALTER TABLE buy_requests ADD COLUMN moderation_hidden boolean NOT NULL DEFAULT false;
ALTER TABLE buy_requests ADD COLUMN moderation_version integer NOT NULL DEFAULT 0;
ALTER TABLE reports ADD COLUMN moderation_version integer NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN restricted_until timestamptz;
ALTER TABLE users ADD COLUMN moderation_version integer NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX audit_admin_request_key ON audit_logs(actor_id,(metadata->>'requestKey'))
 WHERE action LIKE 'admin.%' AND metadata ? 'requestKey';
INSERT INTO admin_permissions(id) VALUES ('products.moderate'),('requests.moderate'),('moderation.decide'),('users.restrict');
INSERT INTO admin_role_permissions(role_id,permission_id)
 SELECT r.id,p.id FROM admin_roles r CROSS JOIN admin_permissions p
 WHERE r.id IN ('super_admin','admin') AND p.id IN ('products.moderate','requests.moderate','moderation.decide','users.restrict');
INSERT INTO admin_role_permissions(role_id,permission_id) VALUES
 ('moderator','users.read'),('moderator','products.moderate'),('moderator','requests.moderate'),('moderator','moderation.decide');
