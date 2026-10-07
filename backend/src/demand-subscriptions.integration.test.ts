import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');
  const { notifyDemandSubscriptions } = await import('./demand-subscriptions.js');
  const { searchSettlements } = await import('./settlements.js');

  describe('basic seller demand subscriptions (real DB)', () => {
    const app = createApp();
    const seller = request.agent(app);
    const buyer = request.agent(app);
    const other = request.agent(app);
    const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
    const userIds: string[] = [];
    let categoryId: string;
    let parentId: string;
    let otherCategoryId: string;
    const rivne = searchSettlements('Рівне').settlements.find(item => item.name === 'Рівне' && item.region === 'Рівненська область')!;
    const kyiv = searchSettlements('Київ').settlements.find(item => item.name === 'Київ')!;
    type Agent = typeof seller;

    const subscribe = async (agent: Agent = seller, fields: Record<string, unknown> = {}) => {
      const response = await agent.post('/api/demand-subscriptions').send({ categoryId, countryCode: 'UA', ...fields });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body.subscription;
    };
    const createRequest = async (fields: Record<string, unknown> = {}) => {
      const response = await buyer.post('/api/buy-requests').send({
        categoryId, title: 'Потрібен мед для Step 8', description: '', quantity: 10, unit: 'kg', currency: 'UAH',
        minPrice: 1, maxPrice: 200, delivery: 'no', geoArea: rivne.name, settlementCode: rivne.code,
        address: 'Секретна адреса 123', addressVisibility: 'private', latitude: 50.612345, longitude: 26.212345,
        ...fields,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body.buyRequest.id as string;
    };
    const notifications = async (agent: Agent = seller) => (await agent.get('/api/notifications')).body;

    beforeAll(async () => {
      for (const [index, agent] of [seller, buyer, other].entries()) {
        const username = `demand_${index}_${suffix}`;
        const response = await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA',
          phone: `+38067${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' });
        expect(response.status, JSON.stringify(response.body)).toBe(201);
        userIds.push(response.body.user.id);
      }
      const categories = (await seller.get('/api/categories')).body.categories;
      const honey = categories.find((item: { code: string }) => item.code === 'honey');
      expect(honey?.parentId).toBeTruthy();
      categoryId = honey.id;
      parentId = honey.parentId;
      otherCategoryId = categories.find((item: { id: string; parentId: string | null }) => item.parentId === null && item.id !== parentId).id;
    }, 30000);

    beforeEach(async () => {
      await pool.query('DELETE FROM demand_subscriptions WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM notifications WHERE user_id = ANY($1::uuid[])', [userIds]);
      await pool.query('DELETE FROM buy_requests WHERE buyer_id = ANY($1::uuid[])', [userIds]);
    });
    afterAll(async () => { await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [userIds]); });

    it('creates, lists, reads, edits, disables, enables and deletes only owned subscriptions', async () => {
      const subscription = await subscribe(seller, { region: rivne.region });
      expect(subscription).toMatchObject({ category: { id: categoryId }, region: rivne.region, active: true });
      expect((await seller.get('/api/demand-subscriptions')).body.subscriptions).toHaveLength(1);
      expect((await seller.get(`/api/demand-subscriptions/${subscription.id}`)).body.subscription).toMatchObject(subscription);
      expect((await other.get('/api/demand-subscriptions')).body.subscriptions).toHaveLength(0);
      for (const method of ['get', 'patch', 'delete'] as const) {
        const response = await other[method](`/api/demand-subscriptions/${subscription.id}`).send(method === 'patch' ? { active: false } : undefined);
        expect(response.status).toBe(404);
        expect(response.body.error).toBe('SUBSCRIPTION_NOT_FOUND');
      }
      expect((await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({ categoryId: parentId, region: null, active: false })).body.subscription).toMatchObject({ category: { id: parentId }, region: null, active: false });
      expect((await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({ active: true })).body.subscription.active).toBe(true);
      expect((await seller.delete(`/api/demand-subscriptions/${subscription.id}`)).status).toBe(204);
      expect((await seller.get(`/api/demand-subscriptions/${subscription.id}`)).status).toBe(404);
      expect((await seller.get('/api/demand-subscriptions')).body.subscriptions).toEqual([]);
    });

    it('denies anonymous API access and rejects invalid taxonomy, region, status and ownership injection', async () => {
      for (const method of ['get', 'post'] as const) expect((await request(app)[method]('/api/demand-subscriptions').send({ categoryId })).status).toBe(401);
      for (const fields of [{ categoryId: 'bad' }, { categoryId: randomUUID() }, { region: 'Unknown' }, { active: 'true' }, { userId: userIds[1] }, { latitude: 50 }]) {
        expect((await seller.post('/api/demand-subscriptions').send({ categoryId, ...fields })).status).toBe(400);
      }
      const subscription = await subscribe();
      expect((await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({})).status).toBe(400);
      expect((await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({ categoryId: null })).status).toBe(400);
      expect((await seller.get('/api/demand-subscriptions/not-a-uuid')).status).toBe(404);
    });

    it('matches a leaf and its parent with an optional public region and canonical destination, without private location', async () => {
      await subscribe(seller, { region: rivne.region });
      await subscribe(other, { categoryId: parentId });
      const id = await createRequest();
      for (const agent of [seller, other]) {
        const result = await notifications(agent);
        expect(result.notifications).toHaveLength(1);
        expect(result.notifications[0]).toMatchObject({ type: 'system', context: 'selling', buyRequestId: id, orderId: null, conversationId: null, readAt: null });
        expect(result.notifications[0].title).toContain('Новий запит у категорії');
        expect(result.unreadCounts).toEqual({ total: 1, buying: 0, selling: 1 });
        expect(JSON.stringify(result)).not.toMatch(/Секретна|50\.612345|26\.212345|latitude|longitude|settlementCode|address/);
        const destination = await agent.get(`/api/buy-requests/${id}`);
        expect(destination.status).toBe(200);
        expect(destination.body.buyRequest.delivery.address).toBeNull();
        expect(destination.body.buyRequest.coordinates).not.toEqual({ latitude: 50.612345, longitude: 26.212345 });
      }
    });

    it('does not match a different category, region, or an unknown legacy area', async () => {
      await subscribe(seller, { region: rivne.region });
      await createRequest({ categoryId: otherCategoryId });
      await createRequest({ geoArea: kyiv.name, settlementCode: kyiv.code });
      await createRequest({ geoArea: rivne.region, settlementCode: null });
      expect((await notifications()).notifications).toHaveLength(0);
      await subscribe(other); // Nationwide supports legacy records without settlement identity.
      await createRequest({ geoArea: rivne.region, settlementCode: null });
      expect((await notifications(other)).notifications).toHaveLength(1);
    });

    it('does not match a disabled or deleted subscription and enabling applies to future requests', async () => {
      const disabled = await subscribe(seller, { active: false });
      const deleted = await subscribe(other);
      expect((await other.delete(`/api/demand-subscriptions/${deleted.id}`)).status).toBe(204);
      await createRequest();
      expect((await notifications()).notifications).toHaveLength(0);
      expect((await notifications(other)).notifications).toHaveLength(0);
      await seller.patch(`/api/demand-subscriptions/${disabled.id}`).send({ active: true });
      await createRequest();
      expect((await notifications()).notifications).toHaveLength(1);
    });

    it('uses edited criteria for future requests without replaying old requests', async () => {
      const oldId = await createRequest();
      const subscription = await subscribe(seller, { categoryId: otherCategoryId });
      await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({ categoryId, region: rivne.region });
      await notifyDemandSubscriptions(pool, oldId);
      expect((await notifications()).notifications).toHaveLength(0);
      const newId = await createRequest();
      expect((await notifications()).notifications[0].buyRequestId).toBe(newId);
      await buyer.patch(`/api/buy-requests/${newId}`).send({ title: 'Оновлений запит' });
      expect((await notifications()).notifications).toHaveLength(1);
    });

    it('suppresses concurrent retries per subscription/request at the DB boundary and preserves delivered history on delete', async () => {
      const subscription = await subscribe();
      const id = await createRequest();
      await Promise.all([notifyDemandSubscriptions(pool, id), notifyDemandSubscriptions(pool, id), notifyDemandSubscriptions(pool, id)]);
      expect((await notifications()).notifications).toHaveLength(1);
      await expect(pool.query(`INSERT INTO notifications (user_id, type, title, context, buy_request_id, demand_subscription_id)
        VALUES ($1, 'system', 'Duplicate', 'selling', $2, $3)`, [userIds[0], id, subscription.id])).rejects.toMatchObject({ code: '23505' });
      await seller.delete(`/api/demand-subscriptions/${subscription.id}`);
      expect((await notifications()).notifications).toHaveLength(1);
    });

    it('does not notify the author of a matching own request', async () => {
      await subscribe(buyer);
      await subscribe();
      await createRequest();
      expect((await notifications(buyer)).notifications).toHaveLength(0);
      expect((await notifications()).notifications).toHaveLength(1);
    });

    it('requires category and country/region/cities only, rejecting contradictory and unsafe criteria', async () => {
      expect((await seller.post('/api/demand-subscriptions').send({ categoryId })).status).toBe(400);
      for (const geography of [{ countryCode: 'UA' }, { region: rivne.region }, { settlementCodes: [rivne.code] }]) {
        const response = await seller.post('/api/demand-subscriptions').send({ categoryId, ...geography });
        expect(response.status, JSON.stringify(response.body)).toBe(201);
      }
      for (const fields of [{ minQuantity: 50, maxQuantity: 10, unit: 'kg' }, { minQuantity: 10 }, { minPrice: 170, unit: 'kg' },
        { minPrice: 200, maxPrice: 100, unit: 'kg', currency: 'UAH' }, { settlementCodes: ['unknown'] }, { countryCode: 'PL', region: rivne.region },
        { region: rivne.region, settlementCodes: [kyiv.code] }, { radiusKm: 25 }, { center: { latitude: 50, longitude: 26 } },
        { radiusKm: 201, center: { latitude: 50, longitude: 26 } }, { receiptMethods: ['CARRIER'] }]) {
        expect((await seller.post('/api/demand-subscriptions').send({ categoryId, countryCode: 'UA', ...fields })).status).toBe(400);
      }
      const saved = await subscribe(seller, { minQuantity: 10, maxQuantity: 50, unit: 'kg' });
      expect((await seller.patch(`/api/demand-subscriptions/${saved.id}`).send({ minQuantity: 60 })).status).toBe(400);
      expect((await seller.get(`/api/demand-subscriptions/${saved.id}`)).body.subscription.minQuantity).toBe(10);
      expect((await seller.patch(`/api/demand-subscriptions/${saved.id}`).send({ countryCode: null })).status).toBe(400);
    });

    it('matches country identity rather than author country or guessed text', async () => {
      await subscribe(seller, { countryCode: 'PL' });
      await createRequest();
      const polish = await createRequest({ countryCode: 'PL', settlementCode: null, geoArea: 'Варшава' });
      expect((await notifications()).notifications.map((item: { buyRequestId: string }) => item.buyRequestId)).toEqual([polish]);
      expect((await buyer.post('/api/buy-requests').send({ categoryId, title: 'Invalid country', description: '', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: rivne.name, settlementCode: rivne.code, countryCode: 'PL' })).status).toBe(400);
      const ukrainian = await createRequest();
      expect((await buyer.patch(`/api/buy-requests/${ukrainian}`).send({ countryCode: 'PL' })).status).toBe(400);
      expect((await buyer.patch(`/api/buy-requests/${polish}`).send({ settlementCode: rivne.code })).status).toBe(400);
      expect((await buyer.patch(`/api/buy-requests/${ukrainian}`).send({ countryCode: 'PL', settlementCode: null, geoArea: 'Варшава' })).status).toBe(200);
    });

    it('matches one or multiple canonical cities, including disambiguated names', async () => {
      await subscribe(seller, { settlementCodes: [rivne.code] });
      await subscribe(other, { settlementCodes: [rivne.code, kyiv.code] });
      await createRequest();
      await createRequest({ geoArea: kyiv.name, settlementCode: kyiv.code });
      await createRequest({ geoArea: 'Рівне', settlementCode: null });
      expect((await notifications()).notifications).toHaveLength(1);
      expect((await notifications(other)).notifications).toHaveLength(2);
      const saved = (await other.get('/api/demand-subscriptions')).body.subscriptions[0];
      expect(saved.settlements.map((city: { code: string }) => city.code)).toEqual([rivne.code, kyiv.code]);
    });

    it('checks quantity bounds, units and kg/ton conversion', async () => {
      await subscribe(seller, { minQuantity: 10, maxQuantity: 50, unit: 'kg' });
      await createRequest({ quantity: 9 });
      await createRequest({ quantity: 51 });
      await createRequest({ quantity: 20, unit: 'piece' });
      const matched = await createRequest({ quantity: 0.02, unit: 'ton' });
      expect((await notifications()).notifications.map((item: { buyRequestId: string }) => item.buyRequestId)).toEqual([matched]);
      expect((await buyer.post('/api/buy-requests').send({ categoryId, title: 'Missing quantity', description: '', unit: 'kg', currency: 'UAH', countryCode: 'UA', geoArea: 'Рівне' })).status).toBe(400);
    });

    it('checks budget overlap, per-unit conversion, currency and missing price policy', async () => {
      await subscribe(seller, { minPrice: 170, maxPrice: 190, unit: 'kg', currency: 'UAH' });
      await createRequest({ minPrice: 100, maxPrice: 169 });
      await createRequest({ minPrice: 191, maxPrice: 200 });
      await createRequest({ currency: 'EUR' });
      await createRequest({ minPrice: null, maxPrice: null });
      const exact = await createRequest({ exactPrice: 180, minPrice: undefined, maxPrice: undefined });
      const tons = await createRequest({ quantity: 1, unit: 'ton', minPrice: 180000, maxPrice: 180000 });
      expect((await notifications()).notifications.map((item: { buyRequestId: string }) => item.buyRequestId).sort()).toEqual([exact, tons].sort());
      await subscribe(other); // Empty price criteria accept unpriced Requests.
      const unpriced = await createRequest({ minPrice: undefined, maxPrice: undefined });
      expect((await notifications(other)).notifications[0].buyRequestId).toBe(unpriced);
      expect((await notifications()).notifications).toHaveLength(2);
    });

    it('uses explicit SELF_PICKUP/SELLER_DELIVERY and fails closed on ambiguous legacy receipt', async () => {
      await subscribe(seller, { receiptMethods: ['SELF_PICKUP'] });
      await subscribe(other, { receiptMethods: ['SELLER_DELIVERY'] });
      const delivered = await createRequest({ receiptMethod: 'SELLER_DELIVERY', delivery: undefined });
      const pickup = await createRequest({ receiptMethod: 'SELF_PICKUP', delivery: undefined });
      await createRequest({ delivery: 'yes', preferredDelivery: 'carrier' });
      await createRequest({ delivery: undefined });
      expect((await notifications()).notifications.map((item: { buyRequestId: string }) => item.buyRequestId)).toEqual([pickup]);
      expect((await notifications(other)).notifications.map((item: { buyRequestId: string }) => item.buyRequestId)).toEqual([delivered]);
      expect((await buyer.get(`/api/buy-requests/${delivered}`)).body.buyRequest).toMatchObject({ receiptMethod: 'SELLER_DELIVERY', delivery: { required: true, preferred: 'seller_delivery' } });
      await buyer.patch(`/api/buy-requests/${delivered}`).send({ receiptMethod: 'SELF_PICKUP' });
      expect((await buyer.get(`/api/buy-requests/${delivered}`)).body.buyRequest).toMatchObject({ receiptMethod: 'SELF_PICKUP', delivery: { required: false, preferred: 'pickup' } });
      await buyer.patch(`/api/buy-requests/${delivered}`).send({ delivery: 'yes' });
      expect((await buyer.get(`/api/buy-requests/${delivered}`)).body.buyRequest.receiptMethod).toBeNull();
      expect((await buyer.patch(`/api/buy-requests/${pickup}`).send({ receiptMethod: 'SELLER_DELIVERY', delivery: 'no' })).status).toBe(400);
    });

    it('uses the public rounded point for radius without leaking or measuring private coordinates', async () => {
      await subscribe(seller, { center: { latitude: 50.61, longitude: 26.21 }, radiusKm: 0.2 });
      await subscribe(other, { center: { latitude: 50.6149, longitude: 26.2149 }, radiusKm: 0.2 });
      const id = await createRequest({ latitude: 50.6149, longitude: 26.2149, mapLocationMode: 'approximate' });
      expect((await notifications()).notifications).toHaveLength(1);
      expect((await notifications(other)).notifications).toHaveLength(0); // Private exact point would have matched.
      expect(JSON.stringify(await notifications())).not.toMatch(/50\.6149|26\.2149|Секретна/);
      await createRequest({ latitude: 49, longitude: 24 });
      await createRequest({ latitude: null, longitude: null });
      expect((await notifications()).notifications).toHaveLength(1);
      expect((await notifications()).notifications[0].buyRequestId).toBe(id);
    });

    it('rolls back both the new request and notification if their transaction is rolled back', async () => {
      await subscribe();
      const client = await pool.connect();
      let id: string;
      try {
        await client.query('BEGIN');
        const inserted = await client.query(`INSERT INTO buy_requests (buyer_id, category_id, title, description, requested_quantity, unit, currency, geo_area, country_code)
          VALUES ($1,$2,'Rollback demand test','',10,'kg','UAH','Рівне','UA') RETURNING id`, [userIds[1], categoryId]);
        id = inserted.rows[0].id;
        await notifyDemandSubscriptions(client, id);
        expect((await client.query('SELECT 1 FROM notifications WHERE buy_request_id = $1 AND user_id = $2', [id, userIds[0]])).rowCount).toBe(1);
      } finally { await client.query('ROLLBACK'); client.release(); }
      expect((await pool.query('SELECT 1 FROM buy_requests WHERE id = $1', [id!])).rowCount).toBe(0);
      expect((await notifications()).notifications).toHaveLength(0);
    });
  });
} else {
  describe.skip('basic seller demand subscriptions (requires DATABASE_URL)', () => {});
}
