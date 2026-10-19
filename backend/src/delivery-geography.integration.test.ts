import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');
  const { notifyDemandSubscriptions } = await import('./demand-subscriptions.js');
  const app = createApp();
  const buyer = request.agent(app);
  const seller = request.agent(app);
  const users: string[] = [];
  const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
  const rivne = 'UA56060470010041018';
  const place = { settlementCode: rivne, region: 'Рівненська область', publicPoint: { latitude: 50.62, longitude: 26.25 } };
  const polygon = { type: 'Polygon', coordinates: [[[26.15, 50.55], [26.35, 50.55], [26.35, 50.68], [26.15, 50.68], [26.15, 50.55]]] };
  let categoryId: string;
  let subscriptionId: string;
  const notificationCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id = $1', [subscriptionId])).rows[0].count);
  const requestBody = (latitude: number | null = 50.6199, longitude: number | null = 26.2516) => ({ categoryId, title: `Географія ${suffix}`, description: '', quantity: 5, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: rivne, latitude, longitude, mapLocationMode: 'pin', countryCode: 'UA', deliveryOptions: [{ method: 'SELLER_DELIVERY' }], fulfillmentMode: 'multiple_sellers' });

  describe('delivery geography at API and matching boundaries (real PostgreSQL)', () => {
    beforeAll(async () => {
      vi.stubGlobal('fetch', async (url: string) => {
        const parsed = new URL(String(url));
        if (parsed.pathname.endsWith('/reverse')) return { ok: true, json: async () => ({ address: { country_code: 'ua', state: parsed.searchParams.get('lat') === '50.62' ? 'Рівненська область' : 'Київська область' } }) };
        return { ok: true, json: async () => parsed.searchParams.get('city') === 'Рівне' ? [{ name: 'Рівне', category: 'boundary', type: 'administrative', osm_type: 'relation', osm_id: 448930, extratags: { admin_level: '8' }, address: { country_code: 'ua', state: 'Рівненська область', county: 'Рівненський район' }, geojson: polygon }] : [] };
      });
      for (const [index, agent] of [buyer, seller].entries()) {
        const username = `geo14_${index}_${suffix}`;
        const registered = await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${suffix.slice(0, 7).replace(/[^0-9]/g, '1')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' });
        expect(registered.status, JSON.stringify(registered.body)).toBe(201);
        users.push(registered.body.user.id);
      }
      categoryId = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains').id;
    });
    afterAll(async () => {
      if (users.length) await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
      vi.unstubAllGlobals();
    });

    it('rejects foreign points, preserves edits, and never notifies from corrupt legacy coordinates', async () => {
      const local = [{ method: 'SELLER_DELIVERY', radiusKm: 10, place }];
      const invalidSubscription = await seller.post('/api/demand-subscriptions').send({ categoryId, region: 'Рівненська область', deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 10, place: { ...place, publicPoint: { latitude: 0, longitude: 0 } } }] });
      expect(invalidSubscription.status).toBe(400);
      expect((await pool.query('SELECT count(*)::int AS count FROM demand_subscriptions WHERE user_id=$1', [users[1]])).rows[0].count).toBe(0);
      const subscription = await seller.post('/api/demand-subscriptions').send({ categoryId, region: 'Рівненська область', deliveryOptions: local });
      expect(subscription.status, JSON.stringify(subscription.body)).toBe(201);
      subscriptionId = subscription.body.subscription.id;

      for (const coordinates of [[0, 0], [50.45, 30.52], [50.75, 25.33]]) {
        const failed = await buyer.post('/api/buy-requests').send(requestBody(...coordinates));
        expect(failed.status, JSON.stringify(failed.body)).toBe(400);
      }
      expect((await pool.query('SELECT count(*)::int AS count FROM buy_requests WHERE buyer_id=$1', [users[0]])).rows[0].count).toBe(0);
      expect(await notificationCount()).toBe(0);

      const valid = await buyer.post('/api/buy-requests').send(requestBody());
      expect(valid.status, JSON.stringify(valid.body)).toBe(201);
      const id = valid.body.buyRequest.id;
      expect(await notificationCount()).toBe(1);
      const before = (await pool.query('SELECT latitude, longitude, settlement_code, updated_at FROM buy_requests WHERE id=$1', [id])).rows[0];
      const edit = await buyer.patch(`/api/buy-requests/${id}`).send({ latitude: 0, longitude: 0 });
      expect(edit.status).toBe(400);
      expect((await pool.query('SELECT latitude, longitude, settlement_code, updated_at FROM buy_requests WHERE id=$1', [id])).rows[0]).toEqual(before);

      await pool.query('UPDATE buy_requests SET latitude=0, longitude=0 WHERE id=$1', [id]);
      await pool.query('DELETE FROM notifications WHERE demand_subscription_id=$1 AND buy_request_id=$2', [subscriptionId, id]);
      await notifyDemandSubscriptions(pool, id);
      expect(await notificationCount()).toBe(0);
    }, 30000);

    it('rejects new zero-radius rules and never alerts from legacy zero-radius geography', async () => {
      const selfPickup = { method: 'SELF_PICKUP', place };
      const postal = { method: 'POSTAL_DELIVERY', regions: ['Рівненська область'] };
      const zeroRadius = await seller.post('/api/demand-subscriptions').send({
        categoryId, region: 'Рівненська область', deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 0, place }],
      });
      expect(zeroRadius.status).toBe(400);
      expect(zeroRadius.body.fields).toContain('deliveryOptions');

      const postalSubscription = await seller.post('/api/demand-subscriptions').send({ categoryId, region: 'Рівненська область', deliveryOptions: [selfPickup, postal] });
      expect(postalSubscription.status, JSON.stringify(postalSubscription.body)).toBe(201);
      const postalSubscriptionId = postalSubscription.body.subscription.id;
      const postalCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id=$1', [postalSubscriptionId])).rows[0].count);
      const postalRequest = await buyer.post('/api/buy-requests').send({ ...requestBody(null, null), mapLocationMode: 'profile', deliveryOptions: [{ method: 'POSTAL_DELIVERY' }] });
      expect(postalRequest.status, JSON.stringify(postalRequest.body)).toBe(201);
      expect(await postalCount()).toBe(1);

      await pool.query(`UPDATE buy_requests SET latitude=NULL, longitude=NULL, delivery_options=$1::jsonb WHERE id=$2`, [JSON.stringify([{ method: 'SELF_PICKUP', radiusKm: 0 }, { method: 'POSTAL_DELIVERY' }]), postalRequest.body.buyRequest.id]);
      await pool.query('DELETE FROM notifications WHERE demand_subscription_id=$1 AND buy_request_id=$2', [postalSubscriptionId, postalRequest.body.buyRequest.id]);
      await notifyDemandSubscriptions(pool, postalRequest.body.buyRequest.id);
      expect(await postalCount()).toBe(1);

      const pickupSubscription = await seller.post('/api/demand-subscriptions').send({ categoryId, region: 'Рівненська область', deliveryOptions: [selfPickup] });
      expect(pickupSubscription.status, JSON.stringify(pickupSubscription.body)).toBe(201);
      const pickupSubscriptionId = pickupSubscription.body.subscription.id;
      const pickupCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id=$1', [pickupSubscriptionId])).rows[0].count);
      const legacyPickup = await buyer.post('/api/buy-requests').send({ ...requestBody(null, null), mapLocationMode: 'profile', deliveryOptions: [{ method: 'POSTAL_DELIVERY' }] });
      expect(legacyPickup.status, JSON.stringify(legacyPickup.body)).toBe(201);
      await pool.query(`UPDATE buy_requests SET latitude=NULL, longitude=NULL, delivery_options=$1::jsonb WHERE id=$2`, [JSON.stringify([{ method: 'SELF_PICKUP', radiusKm: 0 }]), legacyPickup.body.buyRequest.id]);
      await pool.query('DELETE FROM notifications WHERE demand_subscription_id=$1 AND buy_request_id=$2', [pickupSubscriptionId, legacyPickup.body.buyRequest.id]);
      await notifyDemandSubscriptions(pool, legacyPickup.body.buyRequest.id);
      expect(await pickupCount()).toBe(0);

      const deliverySubscription = await seller.post('/api/demand-subscriptions').send({ categoryId, region: 'Рівненська область', deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 5, place }] });
      expect(deliverySubscription.status, JSON.stringify(deliverySubscription.body)).toBe(201);
      const deliverySubscriptionId = deliverySubscription.body.subscription.id;
      await pool.query('UPDATE demand_subscriptions SET delivery_options=$1::jsonb WHERE id=$2', [JSON.stringify([{ method: 'SELLER_DELIVERY', radiusKm: 0, place: { settlementCode: rivne, region: 'Рівненська область', publicPoint: null } }]), deliverySubscriptionId]);
      const deliveryCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id=$1', [deliverySubscriptionId])).rows[0].count);
      const legacyDelivery = await buyer.post('/api/buy-requests').send({ ...requestBody(null, null), mapLocationMode: 'profile', deliveryOptions: [{ method: 'SELLER_DELIVERY' }] });
      expect(legacyDelivery.status, JSON.stringify(legacyDelivery.body)).toBe(201);
      expect(await deliveryCount()).toBe(0);
    }, 30000);

    it('rejects invalid Product, Offer and region points while retaining valid postal and flexible terms', async () => {
      const productBody = { categoryId, title: `Товар ${suffix}`, description: '', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', deliveryOptions: [{ method: 'SELF_PICKUP' }, { method: 'POSTAL_DELIVERY', nationwide: true }], geoZone: 'Рівне', settlementCode: rivne, latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active' };
      expect((await seller.post('/api/products').send({ ...productBody, latitude: 0, longitude: 0 })).status).toBe(400);
      expect((await seller.post('/api/products').send({ ...productBody, latitude: 50.45, longitude: 30.52 })).status).toBe(400);
      const wrongRegion = await seller.post('/api/products').send({ ...productBody, settlementCode: null, geoZone: 'Рівненська область', latitude: 50.45, longitude: 30.52 });
      expect(wrongRegion.status).toBe(400);
      const product = await seller.post('/api/products').send(productBody);
      expect(product.status, JSON.stringify(product.body)).toBe(201);
      const productId = product.body.product.id;
      expect((await seller.patch(`/api/products/${productId}`).send({ latitude: 50.45, longitude: 30.52 })).status).toBe(400);
      expect((await pool.query('SELECT latitude::float8 AS latitude FROM products WHERE id=$1', [productId])).rows[0].latitude).toBe(50.6199);

      const requestResult = await buyer.post('/api/buy-requests').send({ ...requestBody(), deliveryOptions: [{ method: 'POSTAL_DELIVERY' }] });
      expect(requestResult.status).toBe(201);
      const requestId = requestResult.body.buyRequest.id;
      const terms = { creationMode: 'manual', title: 'Поштова пропозиція', quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Пошта' };
      expect((await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 10, place: { ...place, publicPoint: { latitude: 0, longitude: 0 } } }] })).status).toBe(400);
      const postal = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: [{ method: 'POSTAL_DELIVERY', nationwide: true }] });
      expect(postal.status, JSON.stringify(postal.body)).toBe(201);
      expect(postal.body.offer.deliveryCompatibility.status).toBe('EXACT_MATCH');
      expect((await pool.query('SELECT count(*)::int AS count FROM offers WHERE buy_request_id=$1', [requestId])).rows[0].count).toBe(1);
    }, 30000);

    it('enforces radius limits and ignores a corrupted historical subscription center', async () => {
      const criteria = { categoryId, region: 'Рівненська область', center: { latitude: 50.62, longitude: 26.25 }, radiusKm: 1, deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 10, place }] };
      expect((await seller.post('/api/demand-subscriptions').send({ ...criteria, radiusKm: 200.01 })).status).toBe(400);
      expect((await seller.post('/api/demand-subscriptions').send({ ...criteria, center: { latitude: 0, longitude: 0 } })).status).toBe(400);
      const created = await seller.post('/api/demand-subscriptions').send(criteria);
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const radiusSubscriptionId = created.body.subscription.id;
      expect((await seller.patch(`/api/demand-subscriptions/${radiusSubscriptionId}`).send({ center: { latitude: 0, longitude: 0 } })).status).toBe(400);
      expect((await pool.query('SELECT center_latitude::float8 AS latitude FROM demand_subscriptions WHERE id=$1', [radiusSubscriptionId])).rows[0].latitude).toBe(50.62);
      const count = async () => Number((await pool.query('SELECT count(*)::int AS count FROM notifications WHERE demand_subscription_id=$1', [radiusSubscriptionId])).rows[0].count);
      const first = await buyer.post('/api/buy-requests').send(requestBody());
      expect(first.status).toBe(201);
      expect(await count()).toBe(1);
      await pool.query('UPDATE demand_subscriptions SET center_latitude=0, center_longitude=0 WHERE id=$1', [radiusSubscriptionId]);
      const second = await buyer.post('/api/buy-requests').send(requestBody());
      expect(second.status).toBe(201);
      expect(await count()).toBe(1);
    }, 30000);

    it('applies the 1 km minimum through Product, Request, Offer and Subscription APIs', async () => {
      const invalidRadii: unknown[] = [0, 0.5, 0.99, -1, null, '1', 'invalid', Number.NaN, Number.POSITIVE_INFINITY];
      const sellerOption = (radiusKm: unknown) => [{ method: 'SELLER_DELIVERY', radiusKm, place }];
      const buyerOption = (radiusKm: unknown) => [{ method: 'SELF_PICKUP', radiusKm }];
      const productBody = { categoryId, title: `Радіус ${suffix}`, description: '', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'seller_delivery', geoZone: 'Рівне', settlementCode: rivne, latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active' };
      const productCount = async () => Number((await pool.query('SELECT count(*)::int AS count FROM products WHERE owner_id=$1', [users[1]])).rows[0].count);
      const initialProducts = await productCount();
      for (const radiusKm of invalidRadii) {
        const response = await seller.post('/api/products').send({ ...productBody, deliveryOptions: sellerOption(radiusKm) });
        expect(response.status, JSON.stringify({ radiusKm, body: response.body })).toBe(400);
      }
      expect(await productCount()).toBe(initialProducts);
      const product = await seller.post('/api/products').send({ ...productBody, deliveryOptions: sellerOption(1) });
      expect(product.status, JSON.stringify(product.body)).toBe(201);
      const productId = product.body.product.id;
      expect((await seller.post('/api/products').send({ ...productBody, deliveryOptions: sellerOption(1.5) })).status).toBe(201);
      expect((await seller.patch(`/api/products/${productId}`).send({ deliveryOptions: sellerOption(0.5) })).status).toBe(400);
      expect((await pool.query('SELECT delivery_options FROM products WHERE id=$1', [productId])).rows[0].delivery_options[0].radiusKm).toBe(1);

      const initialRequests = Number((await pool.query('SELECT count(*)::int AS count FROM buy_requests WHERE buyer_id=$1', [users[0]])).rows[0].count);
      for (const radiusKm of invalidRadii) {
        const response = await buyer.post('/api/buy-requests').send({ ...requestBody(), deliveryOptions: buyerOption(radiusKm) });
        expect(response.status, JSON.stringify({ radiusKm, body: response.body })).toBe(400);
      }
      expect((await pool.query('SELECT count(*)::int AS count FROM buy_requests WHERE buyer_id=$1', [users[0]])).rows[0].count).toBe(initialRequests);
      const buyRequest = await buyer.post('/api/buy-requests').send({ ...requestBody(), deliveryOptions: buyerOption(1) });
      expect(buyRequest.status, JSON.stringify(buyRequest.body)).toBe(201);
      const requestId = buyRequest.body.buyRequest.id;
      expect((await buyer.post('/api/buy-requests').send({ ...requestBody(), deliveryOptions: buyerOption(1.5) })).status).toBe(201);
      expect((await buyer.patch(`/api/buy-requests/${requestId}`).send({ deliveryOptions: buyerOption(0.99) })).status).toBe(400);
      expect((await pool.query('SELECT delivery_options FROM buy_requests WHERE id=$1', [requestId])).rows[0].delivery_options[0].radiusKm).toBe(1);

      const terms = { creationMode: 'manual', title: 'Пропозиція з радіусом', quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Доставка' };
      for (const radiusKm of invalidRadii) {
        const response = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: sellerOption(radiusKm) });
        expect(response.status, JSON.stringify({ radiusKm, body: response.body })).toBe(400);
      }
      expect((await pool.query('SELECT count(*)::int AS count FROM offers WHERE buy_request_id=$1', [requestId])).rows[0].count).toBe(0);
      const offer = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: sellerOption(1) });
      expect(offer.status, JSON.stringify(offer.body)).toBe(201);
      const offerId = offer.body.offer.id;
      expect((await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: sellerOption(1.5) })).status).toBe(201);
      expect((await seller.patch(`/api/offers/${offerId}`).send({ deliveryOptions: sellerOption(0.5) })).status).toBe(400);
      expect((await pool.query('SELECT delivery_options FROM offers WHERE id=$1', [offerId])).rows[0].delivery_options[0].radiusKm).toBe(1);

      const center = { latitude: 50.62, longitude: 26.25 };
      const subscriptionBody = { categoryId, region: 'Рівненська область', center, deliveryOptions: sellerOption(1) };
      const initialSubscriptions = Number((await pool.query('SELECT count(*)::int AS count FROM demand_subscriptions WHERE user_id=$1', [users[1]])).rows[0].count);
      for (const radiusKm of invalidRadii) {
        const territory = await seller.post('/api/demand-subscriptions').send({ ...subscriptionBody, radiusKm });
        expect(territory.status, JSON.stringify({ radiusKm, body: territory.body })).toBe(400);
        const delivery = await seller.post('/api/demand-subscriptions').send({ ...subscriptionBody, radiusKm: 1, deliveryOptions: sellerOption(radiusKm) });
        expect(delivery.status, JSON.stringify({ radiusKm, body: delivery.body })).toBe(400);
      }
      expect((await pool.query('SELECT count(*)::int AS count FROM demand_subscriptions WHERE user_id=$1', [users[1]])).rows[0].count).toBe(initialSubscriptions);
      const subscription = await seller.post('/api/demand-subscriptions').send({ ...subscriptionBody, radiusKm: 1 });
      expect(subscription.status, JSON.stringify(subscription.body)).toBe(201);
      const subscriptionId = subscription.body.subscription.id;
      expect((await seller.post('/api/demand-subscriptions').send({ ...subscriptionBody, radiusKm: 1.5, deliveryOptions: sellerOption(1.5) })).status).toBe(201);
      expect((await seller.patch(`/api/demand-subscriptions/${subscriptionId}`).send({ radiusKm: 0.5 })).status).toBe(400);
      expect((await seller.patch(`/api/demand-subscriptions/${subscriptionId}`).send({ deliveryOptions: sellerOption(0.99) })).status).toBe(400);
      const stored = (await pool.query('SELECT radius_km::float8 AS radius, delivery_options FROM demand_subscriptions WHERE id=$1', [subscriptionId])).rows[0];
      expect(stored.radius).toBe(1);
      expect(stored.delivery_options[0].radiusKm).toBe(1);
    }, 120000);
  });
}
