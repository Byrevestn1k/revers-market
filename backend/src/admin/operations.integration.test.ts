import { searchSettlements } from '../settlements.js';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import request from 'supertest';
import bcrypt from 'bcryptjs';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
const enabled = Boolean(process.env.ADMIN_TEST_DATABASE_URL && process.env.ADMIN_TEST_DATABASE_URL === process.env.DATABASE_URL && new URL(process.env.DATABASE_URL!).pathname === '/admin_part2_test');
if (enabled) {
  const { createApp } = await import('../app.js');
  const { pool } = await import('../db/client.js');
  const { MapService } = await import('../map-service.js');
  const app = createApp(), ids: string[] = [], users: Record<string,string> = {}, cookies: Record<string,string> = {};
  let product: string, buyRequest: string, report: string, deal: string;
  const origin = process.env.FRONTEND_URL ?? 'http://localhost:5173';
  const mutate = (role: string, resource: string, id: string, body: object, csrf = true) => {
    const call = request(app).post(`/api/admin/${resource}/${id}/actions`).set('Cookie', cookies[role] ?? '');
    if (csrf) call.set('Origin', origin).set('X-Admin-Action','1');
    return call.send(body);
  };
  const decision = (action: string, version = 0) => ({ action, version, reason: 'review_completed', requestKey: randomUUID() });
  describe('Part 2 administrative decisions — isolated PostgreSQL', () => {
    beforeAll(async () => {
      for (const role of ['ordinary','seller','admin','moderator','support_agent','analyst','super_admin']) {
        const suffix = randomBytes(6).toString('hex');
        users[role] = (await pool.query(`INSERT INTO users(username,username_normalized,nickname,country_code,phone,password_hash) VALUES($1,$1,$2,'UA',$3,'unusable-fixture') RETURNING id`, [`p2_${suffix}`,`Public ${suffix}`,`+380${Date.now().toString().slice(-8)}${ids.length}`])).rows[0].id;
        ids.push(users[role]);
        const token = randomBytes(32).toString('hex');
        await pool.query("INSERT INTO user_sessions(user_id,token_hash,expires_at) VALUES($1,$2,now()+interval '1 day')", [users[role],createHash('sha256').update(token).digest('hex')]);
        cookies[role] = `navpaky_session=${token}`;
        if (!['ordinary','seller'].includes(role)) await pool.query('INSERT INTO admin_user_roles(user_id,role_id) VALUES($1,$2)', [users[role],role]);
      }
      const category = (await pool.query("SELECT id FROM categories WHERE code='grains'")).rows[0].id;
      product = (await pool.query(`INSERT INTO products(owner_id,category_id,title,description,quantity,reserved_quantity,unit,price,currency,delivery_mode,geo_zone,status,latitude,longitude)
        VALUES($1,$2,'Admin Part2 товар','Public description',10,2,'kg',20,'UAH','pickup','Рівне','active',50.62,26.25) RETURNING id`, [users.seller,category])).rows[0].id;
      buyRequest = (await pool.query(`INSERT INTO buy_requests(buyer_id,category_id,title,requested_quantity,unit,currency,geo_area,latitude,longitude) VALUES($1,$2,'Admin Part2 запит',10,'kg','UAH','Рівне',50.62,26.25) RETURNING id`, [users.ordinary,category])).rows[0].id;
      const place = searchSettlements('Рівне').settlements.find(p=>p.name === 'Рівне' && p.region === 'Рівненська область')!;
      await pool.query('UPDATE products SET settlement_code=$2 WHERE id=$1',[product,place.code]);
      await pool.query('UPDATE buy_requests SET settlement_code=$2 WHERE id=$1',[buyRequest,place.code]);
      report = (await pool.query("INSERT INTO reports(reporter_id,target_type,target_id,reason,details) VALUES($1,'product',$2,'secret-private','secret-message') RETURNING id", [users.ordinary,product])).rows[0].id;
      deal = (await pool.query(`INSERT INTO orders(buy_request_id,buyer_id,seller_id,status,currency,subtotal,quantity,conditions_snapshot) VALUES($1,$2,$3,'selected','UAH',40,2,'{"original":true}') RETURNING id`, [buyRequest,users.ordinary,users.seller])).rows[0].id;
    });
    afterAll(async () => {
      await pool.query('DELETE FROM audit_logs WHERE actor_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM buy_requests WHERE buyer_id=ANY($1::uuid[])', [ids]);
      await pool.query('DELETE FROM users WHERE id=ANY($1::uuid[])', [ids]);
    });
    it('rejects guests, ordinary users, analysts, support and role escalation', async () => {
      expect((await request(app).post(`/api/admin/products/${product}/actions`).send(decision('hide'))).status).toBe(401);
      for (const role of ['ordinary','analyst','support_agent']) expect((await mutate(role,'products',product,decision('hide'))).status).toBe(403);
      expect((await mutate('ordinary','users',users.seller,{...decision('restrict'),until:new Date(Date.now()+3600000).toISOString()})).status).toBe(403);
      expect((await mutate('moderator','users',users.seller,decision('unrestrict'))).status).toBe(403);
      expect((await request(app).post('/api/admin/grants').set('Cookie',cookies.moderator).set('Origin',origin).set('X-Admin-Action','1').send({userId:users.ordinary,roleId:'admin',reason:'access_assignment'})).status).toBe(403);
    });
    it('requires CSRF, a valid reason and current version; protects staff and self', async () => {
      expect((await mutate('admin','products',product,decision('hide'),false)).status).toBe(403);
      expect((await mutate('admin','products',product,{...decision('hide'),reason:''})).status).toBe(400);
      expect((await mutate('admin','products',product,{...decision('hide'),version:77})).status).toBe(409);
      for (const id of [users.admin,users.super_admin]) expect((await mutate('admin','users',id,decision('unrestrict'))).status).toBe(403);
    });
    it('hides and restores Product without changing commercial data, Deal or reservations', async () => {
      const before = (await pool.query('SELECT * FROM orders WHERE id=$1',[deal])).rows[0];
      const body = decision('hide');
      const [first,repeat] = await Promise.all([mutate('moderator','products',product,body),mutate('moderator','products',product,body)]);
      expect(first.status).toBe(200); expect(repeat.status).toBe(200); expect(repeat.body).toEqual(first.body);
      expect((await mutate('moderator','products',product,{...body,action:'restore'})).status).toBe(409);
      const stock = (await pool.query('SELECT status,quantity,reserved_quantity,moderation_version FROM products WHERE id=$1',[product])).rows[0];
      expect(stock).toEqual({status:'active',quantity:'10.000',reserved_quantity:'2.000',moderation_version:1});
      expect((await pool.query('SELECT * FROM orders WHERE id=$1',[deal])).rows[0]).toEqual(before);
      expect((await request(app).get(`/api/products/${product}`)).status).toBe(404);
      expect((await request(app).get(`/api/products/${product}`).set('Cookie',cookies.seller)).status).toBe(200);
      const search = await request(app).get('/api/products').query({q:'Admin Part2'});
      expect(search.body.products.map((p: {id:string})=>p.id)).not.toContain(product);
      expect((await request(app).post(`/api/products/${product}/conversation`).set('Cookie',cookies.ordinary).send({})).status).toBe(404);
      const map = await new MapService().findMarkers({latitude:50.62,longitude:26.25},{radiusKm:10,showProducts:true,showBuyRequests:false} as never);
      expect(JSON.stringify(map)).not.toContain(product);
      expect((await mutate('moderator','products',product,decision('restore',1))).status).toBe(200);
      expect((await request(app).get(`/api/products/${product}`)).status).toBe(200);
      const audit = await pool.query("SELECT metadata FROM audit_logs WHERE actor_id=$1 AND metadata->>'requestKey'=$2",[users.moderator,body.requestKey]);
      expect(audit.rowCount).toBe(1); expect(audit.rows[0].metadata).toMatchObject({reason:'review_completed',result:'success'});
    });
    it('restoring a paused product never publishes it or changes its commercial state', async () => {
      await pool.query("UPDATE products SET status='paused' WHERE id=$1",[product]);
      expect((await mutate('moderator','products',product,decision('hide',2))).status).toBe(200);
      expect((await mutate('moderator','products',product,decision('restore',3))).status).toBe(200);
      expect((await request(app).get(`/api/products/${product}`)).status).toBe(404);
      expect((await pool.query('SELECT status FROM products WHERE id=$1',[product])).rows[0].status).toBe('paused');
      await pool.query("UPDATE products SET status='active' WHERE id=$1",[product]);
    });
    it('serializes competing decisions and preserves Buy Request quantities and historical Deal', async () => {
      const before = (await pool.query('SELECT requested_quantity,selected_quantity,completed_quantity,status FROM buy_requests WHERE id=$1',[buyRequest])).rows[0];
      const results = await Promise.all([mutate('moderator','requests',buyRequest,decision('hide')),mutate('moderator','requests',buyRequest,decision('restore'))]);
      expect(results.map(r=>r.status).sort()).toEqual([200,409]);
      const hidden = (await pool.query('SELECT moderation_hidden FROM buy_requests WHERE id=$1',[buyRequest])).rows[0].moderation_hidden;
      if (!hidden) expect((await mutate('moderator','requests',buyRequest,decision('hide',1))).status).toBe(200);
      const version = hidden ? 1 : 2;
      expect((await request(app).get(`/api/buy-requests/${buyRequest}`)).status).toBe(404);
      expect((await pool.query('SELECT requested_quantity,selected_quantity,completed_quantity,status FROM buy_requests WHERE id=$1',[buyRequest])).rows[0]).toEqual(before);
      expect((await pool.query('SELECT id FROM orders WHERE id=$1',[deal])).rowCount).toBe(1);
      expect((await mutate('moderator','requests',buyRequest,decision('restore',version))).status).toBe(200);
      expect((await request(app).get(`/api/buy-requests/${buyRequest}`)).status).toBe(200);
    });
    it('records report decisions, returns safe history and prevents legacy env bypass', async () => {
      expect((await mutate('moderator','moderation',report,decision('under_review'))).status).toBe(200);
      expect((await mutate('support_agent','moderation',report,decision('dismissed',1))).status).toBe(403);
      expect((await mutate('moderator','moderation',report,decision('dismissed',1))).status).toBe(200);
      await pool.query("INSERT INTO audit_logs(actor_id,action,entity_type,entity_id,metadata) VALUES($1,'report.moderated','report',$2,'{\"status\":\"open\"}')",[users.moderator,report]);
      const detail = await request(app).get(`/api/admin/moderation/${report}`).set('Cookie',cookies.moderator);
      expect(detail.body.data.history.length).toBe(3);
      expect(JSON.stringify(detail.body)).not.toMatch(/secret-private|secret-message|password|token|phone|address|details|reporterId/);
      process.env.MODERATOR_USER_IDS=users.ordinary;
      try {
        expect((await request(app).get('/api/moderation/reports').set('Cookie',cookies.ordinary)).status).toBe(403);
        expect((await request(app).patch(`/api/moderation/reports/${report}`).set('Cookie',cookies.ordinary).send({status:'resolved'})).status).toBe(410);
      } finally { delete process.env.MODERATOR_USER_IDS; }
    });
    it('enforces temporary restrictions for existing and newly logged in sessions; expiry restores access', async () => {
      expect((await mutate('admin','users',users.ordinary,{...decision('restrict'),until:new Date(Date.now()+31*86400000).toISOString()})).status).toBe(400);
      expect((await mutate('admin','users',users.ordinary,{...decision('restrict'),until:new Date(Date.now()+3600000).toISOString()})).status).toBe(200);
      expect((await request(app).post('/api/reports').set('Cookie',cookies.ordinary).send({})).status).toBe(401);
      const password = randomBytes(24).toString('base64url');
      await pool.query('UPDATE users SET password_hash=$2 WHERE id=$1',[users.ordinary,await bcrypt.hash(password,4)]);
      const username = (await pool.query('SELECT username FROM users WHERE id=$1',[users.ordinary])).rows[0].username;
      const login = await request(app).post('/api/auth/login').send({username,password});
      expect(login.status).toBe(200);
      const newCookie = login.headers['set-cookie'][0].split(';')[0];
      expect((await request(app).get('/api/reports/mine').set('Cookie',newCookie)).status).toBe(401);
      expect((await mutate('admin','users',users.ordinary,decision('unrestrict',1))).status).toBe(200);
      expect((await request(app).get('/api/reports/mine').set('Cookie',cookies.ordinary)).status).toBe(200);
      expect((await mutate('admin','users',users.ordinary,{...decision('restrict',2),until:new Date(Date.now()+3600000).toISOString()})).status).toBe(200);
      await pool.query("UPDATE users SET restricted_until=now()-interval '1 second' WHERE id=$1",[users.ordinary]);
      expect((await request(app).get('/api/reports/mine').set('Cookie',cookies.ordinary)).status).toBe(200);
    });
    it('supports ID/public name search, filters, sorting and safe user detail', async () => {
      const list = await request(app).get('/api/admin/users').query({q:users.seller,sort:'username',order:'ASC',status:'active'}).set('Cookie',cookies.admin);
      expect(list.status).toBe(200); expect(list.body.total).toBe(1);
      const detail = await request(app).get(`/api/admin/users/${users.seller}`).set('Cookie',cookies.support_agent);
      expect(detail.body.data.counts).toMatchObject({products:1,offers:0,deals:1});
      expect(JSON.stringify(detail.body)).not.toMatch(/password|token|phone|email|address|latitude|longitude/i);
      expect((await request(app).get('/api/admin/products').query({sort:'password_hash'}).set('Cookie',cookies.admin)).status).toBe(400);
      const nickname = (await pool.query('SELECT nickname FROM users WHERE id=$1',[users.seller])).rows[0].nickname;
      const publicName = await request(app).get('/api/admin/users').query({q:nickname}).set('Cookie',cookies.admin);
      expect(publicName.status).toBe(200); expect(publicName.body.data.map((u: {id:string})=>u.id)).toContain(users.seller);
      const role = await request(app).get('/api/admin/users').query({q:users.admin,role:'admin'}).set('Cookie',cookies.admin);
      expect(role.body.total).toBe(1);
      const category = (await pool.query('SELECT category_id FROM products WHERE id=$1',[product])).rows[0].category_id;
      const filtered = await request(app).get('/api/admin/products').query({q:product,categoryId:category,authorId:users.seller,region:'Рівненська область',visibility:'visible'}).set('Cookie',cookies.admin);
      expect(filtered.status).toBe(200); expect(filtered.body.total).toBe(1);
      const complaints = await request(app).get('/api/admin/moderation').query({targetType:'product',targetId:product,status:'dismissed',reason:'other'}).set('Cookie',cookies.moderator);
      expect(complaints.status).toBe(200); expect(complaints.body.data.map((r: {id:string})=>r.id)).toContain(report);
      expect((await request(app).get('/api/admin/users').query({from:'2026-02-31'}).set('Cookie',cookies.admin)).status).toBe(400);
      const audit = await pool.query("SELECT DISTINCT action FROM audit_logs WHERE actor_id=ANY($1::uuid[]) AND action LIKE 'admin.%'",[ids]);
      for (const action of ['admin.products.hide','admin.products.restore','admin.requests.hide','admin.requests.restore','admin.users.restrict','admin.users.unrestrict','admin.moderation.under_review','admin.moderation.dismissed']) expect(audit.rows.map(r=>r.action)).toContain(action);

    });
  });
} else describe.skip('Part2 isolated PostgreSQL opt-in',()=>{it('requires admin_part2_test',()=>{});});
