import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';

// Explicit opt-in: this suite creates privileged fixtures only in an isolated DB.
const enabled = Boolean(process.env.ADMIN_TEST_DATABASE_URL && process.env.ADMIN_TEST_DATABASE_URL === process.env.DATABASE_URL);
if (enabled) {
  const { createApp } = await import('../app.js');
  const { pool } = await import('../db/client.js');
  const app = createApp();
  const ids: string[] = [];
  const cookies: Record<string, string> = {};
  const roleIds: Record<string, string> = {};
  const origin = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  describe('admin foundation — isolated PostgreSQL', () => {
    beforeAll(async () => {
      for (const role of ['ordinary', 'moderator', 'analyst', 'super_admin', 'admin']) {
        const suffix = randomBytes(6).toString('hex');
        const user = await pool.query(`INSERT INTO users(username,username_normalized,country_code,phone,password_hash)
          VALUES($1,$1,'UA',$2,'not-a-login-password') RETURNING id`, [`adm_${suffix}`, `+380${Date.now().toString().slice(-7)}${ids.length}`]);
        const id = user.rows[0].id;
        ids.push(id); roleIds[role] = id;
        const token = randomBytes(32).toString('hex');
        await pool.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [id, createHash('sha256').update(token).digest('hex')]);
        cookies[role] = `navpaky_session=${token}`;
        if (role !== 'ordinary') await pool.query('INSERT INTO admin_user_roles(user_id,role_id) VALUES($1,$2)', [id, role]);
      }
    });
    afterAll(async () => {
      await pool.query("DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[]) OR metadata->>'userId'=ANY($2::text[])", [ids, ids]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    });
    it('denies guests on every admin module and direct mutations', async () => {
      for (const path of ['session', 'dashboard', 'users', 'products', 'requests', 'offers', 'deals', 'roles', 'audit', 'moderation', 'export']) {
        expect((await request(app).get(`/api/admin/${path}`)).status).toBe(401);
      }
      expect((await request(app).post('/api/admin/grants').send({})).status).toBe(401);
    });
    it('ordinary users and legacy moderator env cannot enter the admin namespace', async () => {
      process.env.MODERATOR_USER_IDS = roleIds.ordinary;
      try { expect((await request(app).get('/api/admin/session').set('Cookie', cookies.ordinary)).status).toBe(403); }
      finally { delete process.env.MODERATOR_USER_IDS; }
    });
    it('Moderator cannot grant roles and Analyst cannot mutate or read user data', async () => {
      for (const role of ['moderator', 'analyst']) {
        expect((await request(app).post('/api/admin/grants').set('Cookie', cookies[role]).set('Origin', origin).set('X-Admin-Action', '1').send({ userId: roleIds[role], roleId: 'admin', reason: 'access_assignment' })).status).toBe(403);
      }
      expect((await request(app).get('/api/admin/users').set('Cookie', cookies.analyst)).status).toBe(403);
      expect((await request(app).get('/api/admin/products').set('Cookie', cookies.moderator)).status).toBe(200);
    });
    it('returns only allowed fields and real metrics with missing activity data', async () => {
      const users = await request(app).get('/api/admin/users?perPage=2').set('Cookie', cookies.admin);
      expect(users.status).toBe(200);
      const report = await pool.query(`INSERT INTO reports(reporter_id,target_type,target_id,reason,details) VALUES($1,'user',$2,'private-secret-reason','private-secret-details') RETURNING id`, [roleIds.ordinary, roleIds.admin]);
      try {
        const moderation = await request(app).get('/api/admin/moderation').set('Cookie', cookies.moderator);
        expect(moderation.status).toBe(200);
        expect(JSON.stringify(moderation.body)).not.toContain('private-secret');
        expect(moderation.body.data.find((row: { id: string }) => row.id === report.rows[0].id).reason).toBe('Інша причина');
      } finally { await pool.query('DELETE FROM reports WHERE id=$1', [report.rows[0].id]); }

      expect(users.body.data.length).toBeLessThanOrEqual(2);
      for (const row of users.body.data) expect(Object.keys(row).sort()).toEqual(['createdAt', 'id', 'lastSeenAt', 'nickname', 'restrictedUntil', 'username', 'version']);
      const metrics = await request(app).get('/api/admin/dashboard?from=2000-01-01&to=2000-01-02').set('Cookie', cookies.analyst);
      expect(metrics.status).toBe(200);
      expect(metrics.body.metrics.find((m: { id: string }) => m.id === 'dau').value).toBeNull();
      expect(metrics.body.metrics.find((m: { id: string }) => m.id === 'requestResponseRate').value).toBeNull();
      expect(JSON.stringify(metrics.body)).not.toMatch(/latitude|longitude|password|token|phone|address/i);
      expect((await request(app).get('/api/admin/dashboard?from=2000-01-01&to=2026-01-01').set('Cookie', cookies.analyst)).status).toBe(400);
      expect((await request(app).get('/api/admin/users?perPage=1000').set('Cookie', cookies.admin)).status).toBe(400);
      expect((await request(app).get('/api/admin/export').set('Cookie', cookies.analyst)).status).toBe(404);
    });
    it('counts a multi-seller request once and partial acceptance once per offer', async () => {
      const category = (await pool.query("SELECT id FROM categories WHERE code='grains'")).rows[0].id;
      const created: string[] = [];
      try {
        for (let n = 0; n < 2; n++) {
          const result = await pool.query(`INSERT INTO buy_requests(buyer_id,category_id,title,requested_quantity,unit,currency,geo_area,created_at)
            VALUES($1,$2,'Аналітичний запит',10,'kg','UAH','Без точних координат','2001-02-01T12:00:00Z') RETURNING id`, [roleIds.ordinary, category]);
          created.push(result.rows[0].id);
        }
        for (const seller of [roleIds.admin, roleIds.analyst]) {
          await pool.query(`INSERT INTO offers(buy_request_id,seller_id,offered_quantity,accepted_quantity,unit,unit_price,currency,delivery,status,created_at)
            VALUES($1,$2,5,2,'kg',1,'UAH','Самовивіз','partially_accepted','2001-02-01T13:00:00Z')`, [created[0], seller]);
          await pool.query(`INSERT INTO orders(buy_request_id,buyer_id,seller_id,status,currency,subtotal,quantity,created_at)
            VALUES($1,$2,$3,'selected','UAH',2,2,'2001-02-01T14:00:00Z')`, [created[0], roleIds.ordinary, seller]);
        }
        const response = await request(app).get('/api/admin/dashboard?from=2001-02-01&to=2001-02-02').set('Cookie', cookies.analyst);
        expect(response.status).toBe(200);
        const values = Object.fromEntries(response.body.metrics.map((m: { id: string; value: number | null }) => [m.id, m.value]));
        expect(values).toMatchObject({ requests: 2, offers: 2, deals: 2, products: 0, requestResponseRate: 50, offerAcceptanceRate: 100 });
        expect((await request(app).patch('/api/admin/products/00000000-0000-0000-0000-000000000000').set('Cookie', cookies.analyst).send({ status: 'active' })).status).toBe(404);
      } finally { await pool.query('DELETE FROM buy_requests WHERE id=ANY($1::uuid[])', [created]); }
    });
    it('protects critical operations against CSRF, self elevation, superadmin creation and stale sessions', async () => {
      const payload = { userId: roleIds.ordinary, roleId: 'analyst', reason: 'access_assignment' };
      expect((await request(app).post('/api/admin/grants').set('Cookie', cookies.super_admin).send(payload)).status).toBe(403);
      const mutate = (body: object) => request(app).post('/api/admin/grants').set('Cookie', cookies.super_admin).set('Origin', origin).set('X-Admin-Action', '1').send(body);
      expect((await mutate({ ...payload, userId: roleIds.super_admin })).status).toBe(403);
      expect((await mutate({ ...payload, roleId: 'super_admin' })).status).toBe(400);
      const granted = await mutate(payload);
      expect(granted.status).toBe(200);
      expect((await request(app).get('/api/admin/session').set('Cookie', cookies.ordinary)).body.roles).toContain('analyst');
      const revoked = await request(app).delete(`/api/admin/grants/${granted.body.data.id}`).set('Cookie', cookies.super_admin).set('Origin', origin).set('X-Admin-Action', '1').send({ reason: 'access_review' });
      expect(revoked.status).toBe(200);
      expect((await request(app).get('/api/admin/session').set('Cookie', cookies.ordinary)).status).toBe(403);
      const audit = await pool.query("SELECT metadata FROM audit_logs WHERE actor_id=$1 AND action='admin.grant_created'", [roleIds.super_admin]);
      expect(audit.rows[0].metadata).toMatchObject({ result: 'success', reason: 'access_assignment' });
      await pool.query("UPDATE user_sessions SET created_at=now()-interval '2 hours' WHERE user_id=$1", [roleIds.super_admin]);
      expect((await mutate(payload)).status).toBe(401);
    });
    it('expired grants are not permissions', async () => {
      await pool.query("UPDATE admin_user_roles SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE user_id=$1", [roleIds.moderator]);
      expect((await request(app).get('/api/admin/session').set('Cookie', cookies.moderator)).status).toBe(403);
    });
  });
} else describe.skip('admin isolated PostgreSQL (set ADMIN_TEST_DATABASE_URL=DATABASE_URL)', () => { it('requires explicit isolated DB opt-in', () => {}); });
