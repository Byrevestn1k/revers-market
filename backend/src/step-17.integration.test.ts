import { describe, expect, it } from 'vitest';
import request from 'supertest';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');

  describe('Step 17 currencies and seller modes', () => {
    it('keeps USD amounts and enforces one or several sellers under concurrent selection', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const names = ['buyer', 'seller_a', 'seller_b'].map(role => `step17_${role}_${suffix}`);
      const [buyer, sellerA, sellerB] = names.map(() => request.agent(createApp()));
      try {
        for (const [index, agent] of [buyer, sellerA, sellerB].entries()) {
          const result = await agent.post('/api/auth/register').send({ username: names[index], email: `${names[index]}@example.com`, countryCode: 'UA', phone: `+380${['50', '63', '67'][index]}${suffix.slice(-7)}`, password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' });
          expect(result.status).toBe(201);
        }
        const category = (await buyer.get('/api/categories')).body.categories.find((item: { code: string }) => item.code === 'grains');
        const product = await sellerA.post('/api/products').send({ categoryId: category.id, title: `Товар USD ${suffix}`, description: '', quantity: 20, unit: 'kg', price: 100, currency: 'USD', deliveryMode: 'pickup', geoZone: 'Рівне', status: 'active', photos: [] });
        expect(product.status).toBe(201);
        expect(product.body.product.price).toEqual({ amount: 100, currency: 'USD' });
        const productId = product.body.product.id;
        expect((await sellerA.get(`/api/products/${productId}`)).body.product.price).toEqual({ amount: 100, currency: 'USD' });
        expect((await sellerA.patch(`/api/products/${productId}`).send({ price: 101 })).body.product.price).toEqual({ amount: 101, currency: 'USD' });

        const makeRequest = async (title: string, fulfillmentMode?: string) => {
          const response = await buyer.post('/api/buy-requests').send({ categoryId: category.id, title, description: '', quantity: 20, unit: 'kg', currency: 'USD', minPrice: 100, maxPrice: 100, geoArea: 'Рівне', ...(fulfillmentMode ? { fulfillmentMode } : {}) });
          expect(response.status).toBe(201);
          return response.body.buyRequest;
        };
        const makeOffer = async (id: string, agent: typeof sellerA, quantity: number) => {
          const response = await agent.post(`/api/buy-requests/${id}/offers`).send({ quantity, unit: 'kg', price: 100, currency: 'USD', delivery: 'Самовивіз' });
          expect(response.status).toBe(201);
          return response.body.offer.id as string;
        };

        const single = await makeRequest(`Один продавець USD ${suffix}`);
        expect(single.fulfillmentMode).toBe('single_seller');
        expect(single.price).toEqual({ min: 100, max: 100, currency: 'USD' });
        expect((await buyer.patch(`/api/buy-requests/${single.id}`).send({ maxPrice: 110 })).body.buyRequest.price).toEqual({ min: 100, max: 110, currency: 'USD' });
        expect((await sellerA.post(`/api/buy-requests/${single.id}/offers`).send({ quantity: 8, unit: 'kg', price: 100, currency: 'UAH', delivery: 'Самовивіз' })).status).toBe(400);
        const firstOffer = await makeOffer(single.id, sellerA, 8);
        const secondOffer = await makeOffer(single.id, sellerB, 12);
        expect((await sellerA.patch(`/api/offers/${firstOffer}`).send({ price: 100 })).body.offer.price).toEqual({ amount: 100, currency: 'USD' });
        const selected = await buyer.post(`/api/offers/${firstOffer}/accept`).send({ quantity: 8 });
        expect(selected.status).toBe(201);
        expect(selected.body.order).toMatchObject({ quantity: 8 });
        const otherSeller = await buyer.post(`/api/offers/${secondOffer}/accept`).send({ quantity: 12 });
        expect(otherSeller).toMatchObject({ status: 409, body: { error: 'REQUEST_ALREADY_ALLOCATED' } });
        const snapshot = (await pool.query('SELECT currency, subtotal, conditions_snapshot FROM orders WHERE id = $1', [selected.body.order.id])).rows[0];
        expect(snapshot.currency).toBe('USD');
        expect(Number(snapshot.subtotal)).toBe(800);
        expect(snapshot.conditions_snapshot.originalOffer.price).toBe(100);
        expect((await buyer.patch(`/api/orders/${selected.body.order.id}/status`).send({ status: 'cancelled', reason: 'Тест скасування' })).status).toBe(200);
        expect((await buyer.post(`/api/offers/${secondOffer}/accept`).send({ quantity: 12 })).status).toBe(201);

        const multiple = await makeRequest(`Кілька продавців USD ${suffix}`, 'multiple_sellers');
        const [offerA, offerB] = await Promise.all([makeOffer(multiple.id, sellerA, 8), makeOffer(multiple.id, sellerB, 12)]);
        const concurrent = await Promise.all([buyer.post(`/api/offers/${offerA}/accept`).send({ quantity: 8 }), buyer.post(`/api/offers/${offerB}/accept`).send({ quantity: 12 })]);
        expect(concurrent.map(result => result.status)).toEqual([201, 201]);
        expect((await buyer.get(`/api/buy-requests/${multiple.id}`)).body.buyRequest).toMatchObject({ selectedQuantity: 20, remainingQuantity: 0, fulfillmentMode: 'multiple_sellers' });
        const rejectedMode = await buyer.patch(`/api/buy-requests/${multiple.id}`).send({ fulfillmentMode: 'single_seller' });
        expect(rejectedMode).toMatchObject({ status: 409, body: { error: 'FULFILLMENT_MODE_LOCKED' } });
        expect((await pool.query('SELECT fulfillment_mode FROM buy_requests WHERE id = $1', [multiple.id])).rows[0].fulfillment_mode).toBe('multiple_sellers');
      } finally {
        const normalized = names.map(name => name.toLowerCase());
        await pool.query('DELETE FROM orders WHERE buyer_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[])) OR seller_id IN (SELECT id FROM users WHERE username_normalized = ANY($1::text[]))', [normalized]);
        await pool.query('DELETE FROM users WHERE username_normalized = ANY($1::text[])', [normalized]);
      }
    }, 60000);
  });
}
