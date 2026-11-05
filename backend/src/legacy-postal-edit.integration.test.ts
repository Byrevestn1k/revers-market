import { randomUUID as offerTestKey } from 'node:crypto'
import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js')
    const offerRevision = async (id: string) => (await pool.query('SELECT xmin::text AS revision FROM offers WHERE id=$1', [id])).rows[0]?.revision;
  describe('legacy postal edits (real PostgreSQL)', () => {
    it('preserves unchanged legacy Product, Request, Offer and subscription terms', async () => {
      const buyer = request.agent(createApp()), seller = request.agent(createApp());
      const ids: string[] = [];
      const suffix = randomUUID().replaceAll('-', '').slice(0, 12);
      try {
        for (const [index, agent] of [buyer, seller].entries()) {
          const username = `legacy_postal_${index}_${suffix}`;
          const response = await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: `+380${index ? '67' : '50'}${String(Math.floor(Math.random() * 1e7)).padStart(7, '0')}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' });
          expect(response.status).toBe(201); ids.push(response.body.user.id);
        }
        const categoryId = (await seller.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains').id;
        const postal = { method: 'POSTAL_DELIVERY', nationwide: true, postalOperators: ['NOVA_POSHTA'] };
        const oldPostal = { method: 'POSTAL_DELIVERY', nationwide: true };
        const productBody = { categoryId, title: `Legacy postal ${suffix}`, quantity: 10, unit: 'kg', price: 100, currency: 'UAH', deliveryMode: 'carrier', geoZone: 'Рівне', settlementCode: 'UA56060470010041018', latitude: 50.6199, longitude: 26.2516, mapLocationMode: 'pin', status: 'active', photos: [{ url: 'https://example.com/legacy.jpg' }] };
        expect((await seller.post('/api/products').send({ ...productBody, deliveryOptions: [oldPostal] })).status).toBe(400);
        const created = await seller.post('/api/products').send({ ...productBody, deliveryOptions: [postal] });
        expect(created.status).toBe(201); const productId = created.body.product.id;
        const requestBody = { categoryId, title: `Legacy request ${suffix}`, description: '', quantity: 5, unit: 'kg', currency: 'UAH', geoArea: 'Рівне', settlementCode: 'UA56060470010041018', countryCode: 'UA', deliveryOptions: [{ method: 'POSTAL_DELIVERY', postalOperators: ['NOVA_POSHTA'] }], fulfillmentMode: 'multiple_sellers' };
        const buy = await buyer.post('/api/buy-requests').send(requestBody); expect(buy.status).toBe(201);
        const requestId = buy.body.buyRequest.id;
        const offerBody = { creationMode: 'product', productId, quantity: 1, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Пошта', deliveryOptions: [postal] };
        const offer = await seller.post(`/api/buy-requests/${requestId}/offers`).send({ ...offerBody, requestKey: offerTestKey() }); expect(offer.status).toBe(201);
        const deal = await buyer.post(`/api/offers/${offer.body.offer.id}/accept`).send({ expectedRevision: await offerRevision(offer.body.offer.id), quantity: 1 }); expect(deal.status).toBe(201);
        const snapshot = (await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [deal.body.order.id])).rows[0].conditions_snapshot;
        await pool.query('UPDATE products SET delivery_options=$1::jsonb WHERE id=$2', [JSON.stringify([oldPostal]), productId]);
        const patch = (body: object) => seller.patch(`/api/products/${productId}`).send(body);
        expect((await patch({ price: 110 })).status).toBe(200);
        expect((await patch({ title: `Updated ${suffix}`, quantity: 9 })).status).toBe(200);
        expect((await patch({ photos: [] })).status).toBe(200);
        const full = await patch({ title: `Full form ${suffix}`, quantity: 9, price: 110, deliveryMode: 'carrier', deliveryOptions: [oldPostal] });
        expect(full.status, JSON.stringify(full.body)).toBe(200);
        expect(full.body.product.deliveryOptions).toEqual([oldPostal]);
        expect((await patch({ price: 111, deliveryMode: 'carrier' })).status).toBe(200);
        for (const deliveryOptions of [null, [], [{ ...oldPostal, regions: ['Рівненська область'], nationwide: undefined }], [{ ...oldPostal, postalOperators: [] }]]) {
          expect((await patch({ deliveryMode: 'carrier', deliveryOptions })).status).toBe(400);
        }
        expect((await patch({ deliveryMode: 'carrier', deliveryOptions: [postal] })).status).toBe(200);
        expect((await pool.query('SELECT conditions_snapshot FROM orders WHERE id=$1', [deal.body.order.id])).rows[0].conditions_snapshot).toEqual(snapshot);
        await pool.query('UPDATE products SET delivery_options=NULL WHERE id=$1', [productId]);
        expect((await patch({ price: 112, deliveryMode: 'carrier' })).status).toBe(200);
        expect((await patch({ deliveryMode: 'carrier', deliveryOptions: [oldPostal] })).status).toBe(400);
        await pool.query("UPDATE products SET delivery_mode='pickup' WHERE id=$1", [productId]);
        expect((await patch({ deliveryMode: 'carrier' })).status).toBe(400);

        const legacyRequest = await buyer.post('/api/buy-requests').send({ ...requestBody, title: `Legacy request edit ${suffix}` });
        expect(legacyRequest.status).toBe(201); const legacyRequestId = legacyRequest.body.buyRequest.id;
        const legacyBuyer = [{ method: 'POSTAL_DELIVERY' }];
        await pool.query('UPDATE buy_requests SET delivery_options=$1::jsonb WHERE id=$2', [JSON.stringify(legacyBuyer), legacyRequestId]);
        expect((await buyer.patch(`/api/buy-requests/${legacyRequestId}`).send({ title: `Changed ${suffix}`, deliveryOptions: legacyBuyer })).status).toBe(200);
        expect((await buyer.patch(`/api/buy-requests/${legacyRequestId}`).send({ deliveryOptions: [{ method: 'POSTAL_DELIVERY', postalOperators: [] }] })).status).toBe(400);
        const manual = await seller.post(`/api/buy-requests/${legacyRequestId}/offers`).send({ requestKey: offerTestKey(), creationMode: 'manual', title: 'Legacy offer', quantity: 1, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Пошта', deliveryOptions: [postal] });
        expect(manual.status).toBe(201); const offerId = manual.body.offer.id;
        expect(manual.body.offer.deliveryCompatibility.status).toBe('UNKNOWN');
        await pool.query('UPDATE offers SET delivery_options=$1::jsonb WHERE id=$2', [JSON.stringify([oldPostal]), offerId]);
        const editedOffer = await seller.patch(`/api/offers/${offerId}`).send({ note: 'Оновлено', deliveryOptions: [oldPostal] });
        expect(editedOffer.status, JSON.stringify(editedOffer.body)).toBe(200);
        expect(editedOffer.body.offer.deliveryCompatibility.status).toBe('UNKNOWN');
        expect((await seller.patch(`/api/offers/${offerId}`).send({ deliveryOptions: [{ method: 'POSTAL_DELIVERY', regions: ['Рівненська область'] }] })).status).toBe(400);
        const sub = await seller.post('/api/demand-subscriptions').send({ categoryId, countryCode: 'UA', deliveryOptions: [postal] }); expect(sub.status).toBe(201);
        await pool.query('UPDATE demand_subscriptions SET delivery_options=$1::jsonb WHERE id=$2', [JSON.stringify([oldPostal]), sub.body.subscription.id]);
        expect((await seller.patch(`/api/demand-subscriptions/${sub.body.subscription.id}`).send({ active: false, deliveryOptions: [oldPostal] })).status).toBe(200);
        expect((await seller.patch(`/api/demand-subscriptions/${sub.body.subscription.id}`).send({ deliveryOptions: [{ method: 'POSTAL_DELIVERY', regions: ['Рівненська область'] }] })).status).toBe(400);
      } finally {
        if (ids.length) {
          await pool.query('DELETE FROM orders WHERE buyer_id = ANY($1::uuid[]) OR seller_id = ANY($1::uuid[])', [ids]);
          await pool.query('DELETE FROM users WHERE id = ANY($1::uuid[])', [ids]);
        }
      }
    }, 120000);
  });
}
