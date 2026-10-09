import { afterEach, vi, afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');
  const { notifyDemandSubscriptions } = await import('./demand-subscriptions.js');
  const boundaries = await import('./city-boundaries.js');
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
      const response = await agent.post('/api/demand-subscriptions').send({ categoryId, countryCode: fields.region || (fields.settlementCodes as string[] | undefined)?.length ? null : 'UA', ...fields });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return response.body.subscription;
    };
    const createRequest = async (fields: Record<string, unknown> = {}) => {
      const response = await buyer.post('/api/buy-requests').send({
        categoryId, title: 'Потрібен мед для Step 8', description: '', quantity: 10, unit: 'kg', currency: 'UAH',
        minPrice: 1, maxPrice: 200, ...(fields.receiptMethod ? {} : { delivery: 'no' }), geoArea: rivne.name, settlementCode: rivne.code,
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
    afterEach(() => vi.restoreAllMocks());
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
      expect((await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({ categoryId: parentId, countryCode: 'UA', region: null, active: false })).body.subscription).toMatchObject({ category: { id: parentId }, region: null, active: false });
      expect((await seller.patch(`/api/demand-subscriptions/${subscription.id}`).send({ active: true })).body.subscription.active).toBe(true);
      expect((await seller.delete(`/api/demand-subscriptions/${subscription.id}`)).status).toBe(204);
      expect((await seller.get(`/api/demand-subscriptions/${subscription.id}`)).status).toBe(404);
      expect((await seller.get('/api/demand-subscriptions')).body.subscriptions).toEqual([]);
    });

    it('denies anonymous API access and rejects invalid taxonomy, region, status and ownership injection', async () => {
      for (const method of ['get', 'post'] as const) expect((await request(app)[method]('/api/demand-subscriptions').send({ categoryId })).status).toBe(401);
      for (const fields of [{ categoryId: 'bad' }, { categoryId: randomUUID() }, { region: 'Unknown' }, { countryCode: 'toString' }, { active: 'true' }, { userId: userIds[1] }, { latitude: 50 }]) {
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

    it('counts existing public legacy places and notifies future requests using the same directory identity', async () => {
      const mlyniv = searchSettlements('Млинів').settlements.find(item => item.code === 'UA56040190010053186')!;
      const legacy = { settlementCode: null, geoArea: 'Млинів,  Млинівська селищна громада' };
      const oldId = await createRequest({ ...legacy, receiptMethod: 'SELF_PICKUP', unit: 'litre' });
      const city = await subscribe(seller, { settlementCodes: [mlyniv.code] });
      const region = await subscribe(other, { region: mlyniv.region });
      expect(city.matchCount).toBe(1);
      expect(region.matchCount).toBe(1);
      expect((await notifications()).notifications).toHaveLength(0);
      const newId = await createRequest({ ...legacy, receiptMethod: 'SELLER_DELIVERY' });
      for (const [agent, subscription] of [[seller, city], [other, region]] as const) {
        expect((await agent.get(`/api/demand-subscriptions/${subscription.id}`)).body.subscription.matchCount).toBe(2);
        const matches = await agent.get(`/api/demand-subscriptions/${subscription.id}/matches`);
        expect(matches.status).toBe(200);
        expect(matches.body.count).toBe(2);
        expect(matches.body.markers.map((item: { id: string }) => item.id).sort()).toEqual([oldId, newId].sort());
        expect(JSON.stringify(matches.body)).not.toMatch(/Секретна|50\.612345|26\.212345/);
        const alerts = (await notifications(agent)).notifications;
        expect(alerts).toHaveLength(1);
        expect(alerts[0].buyRequestId).toBe(newId);
      }
      await notifyDemandSubscriptions(pool, newId);
      expect((await notifications()).notifications).toHaveLength(1);
      const stored = await pool.query('SELECT settlement_code, geo_area FROM buy_requests WHERE id = ANY($1::uuid[])', [[oldId, newId]]);
      expect(stored.rows.every(row => row.settlement_code === null && row.geo_area === legacy.geoArea)).toBe(true);
    });

    it('never guesses a legacy place from an ambiguous name, foreign country, conflicting qualifier or private address', async () => {
      const mlyniv = searchSettlements('Млинів').settlements.find(item => item.code === 'UA56040190010053186')!;
      const city = await subscribe(seller, { settlementCodes: [mlyniv.code, rivne.code] });
      for (const fields of [{ geoArea: 'Рівне' }, { geoArea: 'Млинів', countryCode: 'PL' },
        { geoArea: 'Млинів, Київська область' }, { geoArea: 'Невідоме місце', address: 'Млинів, Млинівська селищна громада' }]) {
        await createRequest({ settlementCode: null, ...fields });
      }
      expect((await seller.get(`/api/demand-subscriptions/${city.id}`)).body.subscription.matchCount).toBe(0);
      expect((await notifications()).notifications).toHaveLength(0);
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
      expect((await seller.post('/api/demand-subscriptions').send({ countryCode:'UA' })).status).toBe(400);
      for (const geography of [{ countryCode: 'UA' }, { region: rivne.region }, { settlementCodes: [rivne.code] }]) {
        const response = await seller.post('/api/demand-subscriptions').send({ categoryId, ...geography });
        expect(response.status, JSON.stringify(response.body)).toBe(201);
      }
      for (const fields of [{ minQuantity: 50, maxQuantity: 10, unit: 'kg' }, { minQuantity: 10 }, { minPrice: 170, unit: 'kg' },
        { minPrice: 200, maxPrice: 100, unit: 'kg', currency: 'UAH' }, { settlementCodes: ['unknown'] }, { countryCodes: ['toString'] }, { regions: ['Unknown'] }, { countryCodes: ['UA', 'UA'] }, { cityOutsideKm: 21, settlementCodes: [rivne.code] },
        { receiptMethods: [] }, { settlementCodes: [rivne.code, rivne.code] }, { radiusKm: 25 }, { center: { latitude: 50, longitude: 26 } },
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
      const unknown = await createRequest({ minPrice: null, maxPrice: null });
      const exact = await createRequest({ exactPrice: 180, minPrice: undefined, maxPrice: undefined });
      const tons = await createRequest({ quantity: 1, unit: 'ton', minPrice: 180000, maxPrice: 180000 });
      expect((await notifications()).notifications.map((item: { buyRequestId: string }) => item.buyRequestId).sort()).toEqual([unknown, exact, tons].sort());
      await subscribe(other); // Empty price criteria accept unpriced Requests.
      const unpriced = await createRequest({ minPrice: undefined, maxPrice: undefined });
      expect((await notifications(other)).notifications[0].buyRequestId).toBe(unpriced);
      expect((await notifications()).notifications).toHaveLength(4);
    });

    it('matches an unknown buyer budget to a minimum or price range, including another nominal currency', async () => {
      const minimum = await subscribe(seller,{minPrice:170,unit:'kg',currency:'UAH'});
      const range = await subscribe(other,{minPrice:170,maxPrice:190,unit:'kg',currency:'UAH'});
      const unknown = await createRequest({minPrice:null,maxPrice:null,currency:'EUR',receiptMethod:'SELLER_DELIVERY'});
      const known = await createRequest({minPrice:180,maxPrice:180});
      await createRequest({minPrice:100,maxPrice:169});
      await createRequest({minPrice:180,maxPrice:180,currency:'EUR'});
      for(const [agent,saved] of [[seller,minimum],[other,range]] as const){
        expect((await notifications(agent)).notifications.map((n:{buyRequestId:string})=>n.buyRequestId).sort()).toEqual([unknown,known].sort());
        expect((await agent.get('/api/demand-subscriptions/'+saved.id)).body.subscription.matchCount).toBe(2);
        expect((await agent.get('/api/demand-subscriptions/'+saved.id+'/matches')).body.count).toBe(2);
      }
    });

    it('returns public notification details, survives subscription deletion and reflects only public request fields', async () => {
      const saved = await subscribe();
      const id = await createRequest({title:'Мед різнотрав’я',quantity:12.5,receiptMethod:'SELLER_DELIVERY',minPrice:null,maxPrice:null,deadline:'2026-12-01T12:00:00Z',description:'Потрібен свіжий мед. '.repeat(40)});
      const result = await notifications();
      expect(result.notifications[0]).toMatchObject({buyRequestId:id,context:'selling',buyRequestPreview:{title:'Мед різнотрав’я',quantity:12.5,unit:'kg',minPrice:null,maxPrice:null,currency:'UAH',receiptMethod:'SELLER_DELIVERY',publicPlace:'Рівне, Рівненська область'}});
      expect(new Date(result.notifications[0].createdAt).getTime()).toBeGreaterThan(0);
      expect(new Date(result.notifications[0].buyRequestPreview.deadline).toISOString()).toBe('2026-12-01T12:00:00.000Z');
      expect(result.notifications[0].buyRequestPreview.description).toHaveLength(280);
      expect(JSON.stringify(result)).not.toMatch(/Секретна|50\.612345|26\.212345|latitude|longitude|settlementCode|delivery_address/);
      expect((await notifications(other)).notifications).toHaveLength(0);
      await seller.delete('/api/demand-subscriptions/'+saved.id);
      expect((await notifications()).notifications[0].buyRequestPreview.title).toBe('Мед різнотрав’я');
      await buyer.patch('/api/buy-requests/'+id).send({minPrice:175,maxPrice:200,receiptMethod:'SELF_PICKUP',description:'Короткий опис'});
      expect((await notifications()).notifications[0].buyRequestPreview).toMatchObject({minPrice:175,maxPrice:200,receiptMethod:'SELF_PICKUP',description:'Короткий опис'});
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

    it('uses only the public rounded point for suburbs, preserving privacy', async () => {
      const shape = (lat:number,lon:number) => ({rings:[[{latitude:lat-0.0001,longitude:lon-0.0001},{latitude:lat-0.0001,longitude:lon+0.0001},{latitude:lat+0.0001,longitude:lon+0.0001},{latitude:lat+0.0001,longitude:lon-0.0001},{latitude:lat-0.0001,longitude:lon-0.0001}]],maxDistanceKm:0});
      const lutsk = searchSettlements('Луцьк').settlements.find(item=>item.name==='Луцьк')!;
      const lookup = vi.spyOn(boundaries,'settlementAdministrativeBoundary').mockImplementation(async city => city.code===kyiv.code ? shape(50.61,26.21) : shape(50.6149,26.2149));
      const saved = await subscribe(seller,{settlementCodes:[kyiv.code],cityOutsideKm:0});
      await subscribe(other,{settlementCodes:[lutsk.code],cityOutsideKm:0});
      expect(saved).not.toHaveProperty('settlementBoundaries');
      const id = await createRequest({latitude:50.6149,longitude:26.2149,mapLocationMode:'approximate'});
      expect((await notifications()).notifications.map((n:{buyRequestId:string})=>n.buyRequestId)).toEqual([id]);
      expect((await notifications(other)).notifications).toHaveLength(0);
      expect(JSON.stringify(await notifications())).not.toMatch(/50\.6149|26\.2149|Секретна/);
      expect(lookup).toHaveBeenCalledTimes(2); // No provider calls during matching.
      await createRequest({latitude:49,longitude:24});
      await createRequest({latitude:null,longitude:null});
      expect((await notifications()).notifications).toHaveLength(1);
      expect((await seller.patch('/api/demand-subscriptions/'+saved.id).send({cityOutsideKm:null})).status).toBe(200);
      await createRequest({latitude:50.6149,longitude:26.2149,mapLocationMode:'approximate'});
      expect((await notifications()).notifications).toHaveLength(1);
      const exact = await createRequest({geoArea:kyiv.name,settlementCode:kyiv.code,latitude:null,longitude:null});
      expect((await notifications()).notifications.some((n:{buyRequestId:string})=>n.buyRequestId===exact)).toBe(true);
    });

    it('shows a private address approximately and a consented public address exactly', async () => {
      const subscription = await subscribe(seller, { settlementCodes: [rivne.code] });
      const privateId = await createRequest({ mapLocationMode: 'address', addressVisibility: 'private' });
      const privateMatches = (await seller.get(`/api/demand-subscriptions/${subscription.id}/matches`)).body;
      expect(privateMatches.count).toBe(1);
      expect(privateMatches.markers[0]).toMatchObject({ id: privateId, approximate: true, latitude: 50.61, longitude: 26.21 });
      expect(privateMatches.markers[0]).not.toHaveProperty('publicAddress');
      const privateDetail = (await seller.get(`/api/buy-requests/${privateId}`)).body.buyRequest;
      expect(privateDetail.coordinates).toEqual({ latitude: 50.61, longitude: 26.21 });
      expect(privateDetail.delivery.address).toBeNull();
      expect(JSON.stringify(privateMatches)).not.toMatch(/50\.612345|26\.212345|Секретна/);
      expect((await buyer.get(`/api/buy-requests/${privateId}`)).body.buyRequest.coordinates).toEqual({ latitude: 50.612345, longitude: 26.212345 });
      const publicId = await createRequest({ mapLocationMode: 'address', addressVisibility: 'public', addressVisibilityConsent: true, address: 'Публічний магазин 123' });
      const publicMatches = (await seller.get(`/api/demand-subscriptions/${subscription.id}/matches`)).body;
      expect(publicMatches.markers.find((marker:{id:string})=>marker.id===publicId)).toMatchObject({ approximate: false, latitude: 50.612345, longitude: 26.212345, publicAddress: 'Публічний магазин 123' });
      const pinId = await createRequest({ mapLocationMode: 'pin', addressVisibility: 'private' });
      const pinMatches = (await seller.get(`/api/demand-subscriptions/${subscription.id}/matches`)).body;
      expect(pinMatches.markers.find((marker:{id:string})=>marker.id===pinId)).toMatchObject({ approximate: true, latitude: 50.61, longitude: 26.21 });
      expect((await seller.get(`/api/buy-requests/${pinId}`)).body.buyRequest.coordinates).toEqual({ latitude: 50.61, longitude: 26.21 });
      const cityOnlyId = await createRequest({ latitude: null, longitude: null });
      const cityOnlyMatches = (await seller.get(`/api/demand-subscriptions/${subscription.id}/matches`)).body;
      expect(cityOnlyMatches.unmappedRequests.find((item:{id:string})=>item.id===cityOnlyId)).toMatchObject({ settlement: { code: rivne.code, name: rivne.name } });
      expect(JSON.stringify(await notifications())).not.toMatch(/50\.612345|26\.212345|Секретна|Публічний магазин/);
    });

    it('requires reliable boundaries only for enabled suburbs, rejecting injected geometry', async () => {
      vi.spyOn(boundaries,'settlementAdministrativeBoundary').mockResolvedValue(null);
      const result = await seller.post('/api/demand-subscriptions').send({categoryId,settlementCodes:[kyiv.code],cityOutsideKm:10});
      expect(result.status).toBe(400);
      expect(result.body.error).toBe('CITY_BOUNDARY_UNAVAILABLE');
      expect((await seller.get('/api/demand-subscriptions')).body.subscriptions).toHaveLength(0);
      await subscribe(seller,{settlementCodes:[kyiv.code]});
      expect((await seller.post('/api/demand-subscriptions').send({categoryId,settlementCodes:[kyiv.code],settlementBoundaries:{}})).status).toBe(400);
    });

    it('stores a country without redundant criteria and matches settlements across regions', async () => {
      const saved = await subscribe(seller,{countryCode:'UA',region:rivne.region,settlementCodes:[rivne.code,kyiv.code],cityOutsideKm:10});
      expect(saved).toMatchObject({countryCode:'UA',region:null,settlementCodes:[],cityOutsideKm:null,unit:null,currency:null,receiptMethods:['SELF_PICKUP','SELLER_DELIVERY']});
      const ids = [await createRequest({unit:'box',currency:'EUR',minPrice:null,maxPrice:null}), await createRequest({geoArea:kyiv.name,settlementCode:kyiv.code})];
      expect((await notifications()).notifications.map((n:{buyRequestId:string})=>n.buyRequestId).sort()).toEqual(ids.sort());
      const reopened = (await seller.get('/api/demand-subscriptions/'+saved.id)).body.subscription;
      expect(reopened.unit).toBeNull(); expect(reopened.currency).toBeNull();
      expect((await seller.patch('/api/demand-subscriptions/'+saved.id).send({receiptMethods:[]})).status).toBe(400);
      await expect(pool.query('UPDATE demand_subscriptions SET receipt_methods=ARRAY[]::text[] WHERE id=$1',[saved.id])).rejects.toMatchObject({code:'23514'});
    });

    it('unions a region with cities in other regions and drops cities already included', async () => {
      const saved = await subscribe(seller,{region:rivne.region,settlementCodes:[rivne.code,kyiv.code]});
      expect(saved).toMatchObject({countryCode:null,region:rivne.region,settlementCodes:[kyiv.code]});
      const dubno = searchSettlements('Дубно').settlements.find(item=>item.name==='Дубно' && item.region===rivne.region)!;
      const ids = [await createRequest({geoArea:dubno.name,settlementCode:dubno.code}),await createRequest({geoArea:kyiv.name,settlementCode:kyiv.code})];
      const lutsk = searchSettlements('Луцьк').settlements.find(item=>item.name==='Луцьк')!;
      await createRequest({geoArea:lutsk.name,settlementCode:lutsk.code});
      expect((await notifications()).notifications.map((n:{buyRequestId:string})=>n.buyRequestId).sort()).toEqual(ids.sort());
    });

    it('notifies on exact converted quantity and price boundaries without false positives', async () => {
      await subscribe(seller,{minQuantity:1001,maxQuantity:1001,unit:'kg'});
      await subscribe(other,{minPrice:350,maxPrice:350,unit:'ton',currency:'UAH'});
      const quantityId = await createRequest({quantity:1.001,unit:'ton',minPrice:1,maxPrice:1});
      await createRequest({quantity:1.0009,unit:'ton',minPrice:1,maxPrice:1});
      await createRequest({quantity:1.0011,unit:'ton',minPrice:1,maxPrice:1});
      const priceId = await createRequest({minPrice:0.35,maxPrice:0.35});
      await createRequest({minPrice:0.3499,maxPrice:0.3499});
      await createRequest({minPrice:0.3501,maxPrice:0.3501});
      await createRequest({currency:'EUR',minPrice:0.35,maxPrice:0.35});
      expect((await notifications()).notifications.map((n:{buyRequestId:string})=>n.buyRequestId)).toEqual([quantityId]);
      expect((await notifications(other)).notifications.map((n:{buyRequestId:string})=>n.buyRequestId)).toEqual([priceId]);
    });

    it('matches preferred delivery with either method, preserving strict delivery', async () => {
      await subscribe(seller,{receiptMethods:['SELF_PICKUP']});
      await subscribe(other,{receiptMethods:['SELLER_DELIVERY']});
      const preferred = await createRequest({delivery:'preferred'});
      const delivered = await createRequest({delivery:undefined,receiptMethod:'SELLER_DELIVERY'});
      const pickup = await createRequest({delivery:undefined,receiptMethod:'SELF_PICKUP'});
      expect((await notifications()).notifications.map((n:{buyRequestId:string})=>n.buyRequestId).sort()).toEqual([preferred,pickup].sort());
      expect((await notifications(other)).notifications.map((n:{buyRequestId:string})=>n.buyRequestId).sort()).toEqual([preferred,delivered].sort());
    });

    it('preserves old radius during status-only changes until explicitly replaced', async () => {
      const center = {latitude:50.61,longitude:26.21};
      const saved = await subscribe(seller,{center,radiusKm:5});
      const disabled = await seller.patch('/api/demand-subscriptions/'+saved.id).send({active:false});
      expect(disabled.body.subscription).toMatchObject({center,radiusKm:5,active:false});
      const replaced = await seller.patch('/api/demand-subscriptions/'+saved.id).send({center:null,radiusKm:null,active:true});
      expect(replaced.body.subscription).toMatchObject({center:null,radiusKm:null,active:true});
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
    it('persists multiple territories as a union, removes redundant selections and retains legacy clients', async () => {
      const saved = await subscribe(seller, { countryCode: null, countryCodes: ['PL'], regions: [rivne.region, kyiv.region], settlementCodes: [rivne.code, kyiv.code] });
      expect(saved).toMatchObject({ countryCodes: ['PL'], regions: [rivne.region, kyiv.region], settlementCodes: [], matchCount: 0 });
      expect((await seller.get('/api/demand-subscriptions/' + saved.id)).body.subscription).toMatchObject(saved);
      const rivneRequest = await createRequest();
      const kyivRequest = await createRequest({ settlementCode: kyiv.code, geoArea: kyiv.name });
      const polishRequest = await createRequest({ countryCode: 'PL', settlementCode: null, geoArea: 'Варшава' });
      expect((await notifications()).notifications.map((item: { buyRequestId: string }) => item.buyRequestId).sort()).toEqual([rivneRequest, kyivRequest, polishRequest].sort());
      const edited = await seller.patch('/api/demand-subscriptions/' + saved.id).send({ countryCodes: ['UA', 'PL'], regions: [rivne.region], settlementCodes: [kyiv.code], cityOutsideKm: 10 });
      expect(edited.status).toBe(200);
      expect(edited.body.subscription).toMatchObject({ countryCodes: ['UA', 'PL'], regions: [], settlementCodes: [], cityOutsideKm: null, matchCount: 3 });
      const oldClient = await seller.patch('/api/demand-subscriptions/' + saved.id).send({ countryCode: null, region: rivne.region });
      expect(oldClient.body.subscription).toMatchObject({ countryCodes: [], regions: [rivne.region], matchCount: 1 });
    });

    it('counts existing matches and returns the same public results, including unlocated requests, only to the owner', async () => {
      const match = await createRequest({ minPrice: 170, maxPrice: 220, receiptMethod: 'SELLER_DELIVERY' });
      await createRequest({ categoryId: otherCategoryId, minPrice: 170, receiptMethod: 'SELLER_DELIVERY' });
      await createRequest({ maxPrice: 169, receiptMethod: 'SELLER_DELIVERY' });
      await createRequest({ minPrice: 170, receiptMethod: 'SELF_PICKUP' });
      await createRequest({ minPrice: 170, receiptMethod: 'SELLER_DELIVERY', quantity: 9 });
      const ownRequest = await seller.post('/api/buy-requests').send({ categoryId, title: 'Own request', description: '', quantity: 10, unit: 'kg', currency: 'UAH', minPrice: 170, maxPrice: 200, countryCode: 'UA', receiptMethod: 'SELLER_DELIVERY', geoArea: rivne.name, settlementCode: rivne.code });
      expect(ownRequest.status, JSON.stringify(ownRequest.body)).toBe(201);
      const saved = await subscribe(seller, { countryCodes: ['UA'], minQuantity: 10, minPrice: 170, unit: 'kg', currency: 'UAH', receiptMethods: ['SELLER_DELIVERY'] });
      expect(saved.matchCount).toBe(1);
      expect((await notifications()).notifications).toHaveLength(0);
      const response = await seller.get('/api/demand-subscriptions/' + saved.id + '/matches');
      expect(response.status).toBe(200);
      expect(response.body.count).toBe(1);
      expect(response.body.markers.map((item: { id: string }) => item.id)).toEqual([match]);
      expect(response.body.markers[0]).toMatchObject({ kind: 'buyRequest', latitude: 50.61, longitude: 26.21, approximate: true });
      expect(JSON.stringify(response.body)).not.toMatch(/Секретна|50\.612345|26\.212345|settlementBoundaries/);
      expect((await other.get('/api/demand-subscriptions/' + saved.id + '/matches')).status).toBe(404);
      expect((await request(app).get('/api/demand-subscriptions/' + saved.id + '/matches')).status).toBe(401);
      const disabled = await seller.patch('/api/demand-subscriptions/' + saved.id).send({ active: false });
      expect(disabled.body.subscription.matchCount).toBe(1);
      await pool.query("UPDATE buy_requests SET status = 'cancelled' WHERE id = $1", [match]);
      expect((await seller.get('/api/demand-subscriptions/' + saved.id + '/matches')).body.count).toBe(0);
      const unlocated = await createRequest({ latitude: null, longitude: null, minPrice: 180, receiptMethod: 'SELLER_DELIVERY' });
      const missing = await seller.get('/api/demand-subscriptions/' + saved.id + '/matches');
      expect(missing.body.count).toBe(1);
      expect(missing.body.markers).toEqual([]);
      expect(missing.body.unmappedRequests).toEqual([expect.objectContaining({ id: unlocated, title: 'Потрібен мед для Step 8', geoArea: rivne.name })]);
    });

    it('enforces the 20 km suburb limit in API and database', async () => {
      vi.spyOn(boundaries, 'settlementAdministrativeBoundary').mockResolvedValue({ rings: [[{ latitude: 50, longitude: 26 }, { latitude: 50, longitude: 27 }, { latitude: 51, longitude: 27 }, { latitude: 51, longitude: 26 }, { latitude: 50, longitude: 26 }]], maxDistanceKm: 100 });
      const saved = await subscribe(seller, { settlementCodes: [rivne.code], cityOutsideKm: 20 });
      expect(saved.cityOutsideKm).toBe(20);
      expect((await seller.patch('/api/demand-subscriptions/' + saved.id).send({ cityOutsideKm: 21 })).status).toBe(400);
      await expect(pool.query('UPDATE demand_subscriptions SET city_outside_km = 21 WHERE id = $1', [saved.id])).rejects.toMatchObject({ code: '23514' });
    });

  });
} else {
  describe.skip('basic seller demand subscriptions (requires DATABASE_URL)', () => {});
}
