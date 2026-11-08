/** Deliberately offline-only: no HTTP endpoint creates or removes Super Admin. */
import { pool } from '../db/client.js';
import { uuid } from './grants.js';

async function bootstrap() {
  const userId = process.argv[2];
  if (!uuid(userId) || process.env.ADMIN_BOOTSTRAP_ACK !== 'GRANT_SUPER_ADMIN') {
    throw new Error('Usage: ADMIN_BOOTSTRAP_ACK=GRANT_SUPER_ADMIN npm run admin:bootstrap --workspace backend -- <existing-user-uuid>');
  }
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query("SELECT pg_advisory_xact_lock(hashtext('admin-grants'))");
    const user = await db.query('SELECT id FROM users WHERE id=$1', [userId]);
    if (!user.rowCount) throw new Error('Target user does not exist');
    const result = await db.query("INSERT INTO admin_user_roles(user_id,role_id) VALUES($1,'super_admin') RETURNING id", [userId]);
    await db.query(`INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata)
      VALUES(NULL,'admin.super_admin_bootstrap','admin_grant',$1,$2::jsonb)`, [result.rows[0].id, JSON.stringify({ userId, reason: 'controlled_cli_bootstrap', result: 'success' })]);
    await db.query('COMMIT');
    console.log('Super Admin grant created. Keep database credentials restricted and review the audit entry.');
  } catch (error) { await db.query('ROLLBACK'); throw error; } finally { db.release(); }
}
bootstrap().catch(error => { console.error(error instanceof Error ? error.message : 'Bootstrap failed'); process.exitCode = 1; }).finally(() => pool.end());
