-- Administrative grants are independent of marketplace buying/selling activity.
CREATE TABLE admin_permissions (id text PRIMARY KEY);
CREATE TABLE admin_roles (id text PRIMARY KEY, label text NOT NULL);
CREATE TABLE admin_role_permissions (
  role_id text NOT NULL REFERENCES admin_roles(id) ON DELETE CASCADE,
  permission_id text NOT NULL REFERENCES admin_permissions(id) ON DELETE CASCADE,
  PRIMARY KEY(role_id, permission_id)
);
CREATE TABLE admin_user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_id text NOT NULL REFERENCES admin_roles(id),
  granted_by uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at IS NULL OR expires_at > created_at)
);
CREATE UNIQUE INDEX admin_user_role_active_idx ON admin_user_roles(user_id, role_id) WHERE revoked_at IS NULL;
CREATE INDEX admin_user_roles_lookup_idx ON admin_user_roles(user_id, expires_at) WHERE revoked_at IS NULL;
INSERT INTO admin_permissions(id) VALUES
 ('admin.access'),('analytics.read'),('users.read'),('products.read'),('requests.read'),
 ('offers.read'),('deals.read'),('moderation.read'),('audit.read'),('roles.read'),('roles.manage');
INSERT INTO admin_roles(id,label) VALUES
 ('super_admin','Super Admin'),('admin','Admin'),('moderator','Moderator'),('support_agent','Support Agent'),('analyst','Analyst');
INSERT INTO admin_role_permissions SELECT 'super_admin',id FROM admin_permissions;
INSERT INTO admin_role_permissions SELECT 'admin',id FROM admin_permissions WHERE id <> 'roles.manage';
INSERT INTO admin_role_permissions(role_id,permission_id) VALUES
 ('moderator','admin.access'),('moderator','products.read'),('moderator','requests.read'),('moderator','moderation.read'),
 ('support_agent','admin.access'),('support_agent','users.read'),('support_agent','offers.read'),('support_agent','deals.read'),('support_agent','moderation.read'),
 ('analyst','admin.access'),('analyst','analytics.read');
CREATE INDEX admin_audit_created_idx ON audit_logs(created_at DESC,id) WHERE action LIKE 'admin.%';
CREATE INDEX users_admin_created_idx ON users(created_at DESC,id);
CREATE INDEX products_admin_created_idx ON products(created_at DESC,id);
CREATE INDEX requests_admin_created_idx ON buy_requests(created_at DESC,id);
CREATE INDEX offers_admin_created_idx ON offers(created_at DESC,id);
CREATE INDEX orders_admin_created_idx ON orders(created_at DESC,id);
