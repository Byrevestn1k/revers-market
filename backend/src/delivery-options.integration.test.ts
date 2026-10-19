import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');

  describe('structured delivery through Product, Request, Offer and Deal (real DB)', () => {
    it('keeps exact postal terms, rejects an unsupported Product method and locks agreed Request geography', async () => {
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      const buyer = request.agent(createApp());
      const seller = request.agent(createApp());
      const users: string[] = [];
      try {
        for (const [index, agent] of [buyer, seller].entries()) {
          const username = `step14_${index}_${suffix}`;
          const result = await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${suffix.slice(0, 7).replace(/[^0-9]/g, '1')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' });
          expect(result.status, JSON.stringify(result.body)).toBe(201);
          users.push(result.body.user.id);
        }
        const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains');
        const postal = { method: 'POSTAL_DELIVERY', nationwide: true };
        const pickup = { method: 'SELF_PICKUP' };
        const product = await seller.post('/api/products').send({ categoryId: category.id, title: 'Товар Step 14', description: '', quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'pickup', deliveryOptions: [pickup, postal], geoZone: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active' });
        expect(product.status).toBe(201);
        expect(product.body.product.deliveryOptions).toEqual(expect.arrayContaining([pickup, postal]));
        const productId = product.body.product.id;
        const requestResult = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Запит Step 14', description: '', quantity: 5, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', countryCode: 'UA', deliveryOptions: [{ method: 'POSTAL_DELIVERY' }], fulfillmentMode: 'multiple_sellers' });
        expect(requestResult.status).toBe(201);
        const requestId = requestResult.body.buyRequest.id;
        const mapPath = '/api/map/markers?latitude=50.62&longitude=26.25&radiusKm=10&zoom=11';
        const postalMap = await buyer.get(`${mapPath}&deliveryMethod=POSTAL_DELIVERY`);
        expect(postalMap.status).toBe(200);
        expect(postalMap.body.markers.filter((marker: { id: string }) => [productId, requestId].includes(marker.id)).map((marker: { deliveryOptions: unknown }) => marker.deliveryOptions)).toEqual(expect.arrayContaining([[pickup, postal], [{ method: 'POSTAL_DELIVERY' }]]));
        const pickupMap = await buyer.get(`${mapPath}&deliveryMethod=SELF_PICKUP`);
        expect(pickupMap.body.markers.some((marker: { id: string }) => marker.id === productId)).toBe(true);
        expect(pickupMap.body.markers.some((marker: { id: string }) => marker.id === requestId)).toBe(false);
        expect((await buyer.get(`${mapPath}&deliveryMethod=UNKNOWN`)).status).toBe(400);
        const terms = { creationMode: 'product', productId, quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Поштова доставка' };
        expect((await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: [{ method: 'SELLER_DELIVERY', radiusKm: 10 }] })).body.error).toBe('PRODUCT_DELIVERY_MISMATCH');
        const created = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...terms, deliveryOptions: [postal] });
        expect(created.status, JSON.stringify(created.body)).toBe(201);
        expect(created.body.offer.deliveryCompatibility).toMatchObject({ status: 'EXACT_MATCH', methods: ['POSTAL_DELIVERY'] });
        const offerId = created.body.offer.id;
        const before = (await pool.query('SELECT title, delivery_options, settlement_code, updated_at FROM buy_requests WHERE id=$1', [requestId])).rows[0];
        const conflict = await buyer.patch(`/api/buy-requests/${requestId}`).send({ deliveryOptions: [{ method: 'SELF_PICKUP', radiusKm: 1 }], title: 'Не зберігати' });
        expect(conflict).toMatchObject({ status: 409, body: { error: 'DELIVERY_OPTIONS_LOCKED' } });
        const placeConflict = await buyer.patch(`/api/buy-requests/${requestId}`).send({ settlementCode: null, geoArea: 'Київ' });
        expect(placeConflict.status).toBe(409);
        expect((await pool.query('SELECT title, delivery_options, settlement_code, updated_at FROM buy_requests WHERE id=$1', [requestId])).rows[0]).toEqual(before);
        expect((await seller.patch(`/api/buy-requests/${requestId}`).send({ deliveryOptions: [{ method: 'FLEXIBLE' }] })).status).toBe(404);
        const deal = await buyer.post(`/api/offers/${offerId}/accept`).send({ quantity: 5 });
        expect(deal.status, JSON.stringify(deal.body)).toBe(201);
        const snapshot = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [deal.body.order.id])).rows[0].conditions_snapshot;
        expect(snapshot.delivery.options).toEqual([postal]);
        expect((await seller.patch(`/api/offers/${offerId}`).send({ deliveryOptions: [pickup] })).status).toBe(409);
        expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [deal.body.order.id])).rows[0].conditions_snapshot).toEqual(snapshot);
        expect((await seller.patch(`/api/products/${productId}`).send({ title: 'Оновлений товар' })).body.product.deliveryOptions).toEqual(expect.arrayContaining([pickup, postal]));
        const second = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title: 'Паралельний запит Step 14', description: '', quantity: 5, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: 'UA56060470010041018', countryCode: 'UA', deliveryOptions: [{ method: 'POSTAL_DELIVERY' }], fulfillmentMode: 'multiple_sellers' });
        expect(second.status).toBe(201);
        const secondId = second.body.buyRequest.id;
        const [edit, concurrentOffer] = await Promise.all([
          buyer.patch(`/api/buy-requests/${secondId}`).send({ deliveryOptions: [{ method: 'FLEXIBLE' }] }),
          seller.post(`/api/buy-requests/${secondId}/offers`).send({ creationMode: 'manual', title: 'Товар поштою', quantity: 5, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Поштова доставка', deliveryOptions: [postal] }),
        ]);
        expect(concurrentOffer.status).toBe(201);
        expect([200, 409]).toContain(edit.status);
        if (edit.status === 409) expect(edit.body.error).toBe('DELIVERY_OPTIONS_LOCKED');
        const savedOptions = (await pool.query('SELECT delivery_options FROM buy_requests WHERE id=$1', [secondId])).rows[0].delivery_options;
        expect(savedOptions).toEqual(edit.status === 200 ? [{ method: 'FLEXIBLE' }] : [{ method: 'POSTAL_DELIVERY' }]);
      } finally {
        if (users.length) {
          await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [users]);
          await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [users]);
        }
      }
    }, 30000);
  });
}
