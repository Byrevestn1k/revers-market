import { describe, expect, it } from 'vitest';
import request from 'supertest';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');
  const { assessCategory } = await import('./category-recommendation.js');
  describe('category validation through real PostgreSQL and API', () => {
    it('checks create, edit, draft publication, reports, appeals and repeated categories', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const username = `step16_${suffix}`;
      const app = createApp(), seller = request.agent(app), other = request.agent(app);
      const categories = (await request(app).get('/api/categories')).body.categories;
      const id = (code: string) => categories.find((item: { code: string }) => item.code === code).id;
      const honey = id('honey_raw'), auto = id('market-auto--lehkovi-avtomobili');
      const baseProduct = { title: 'Мед натуральний 3 літри', description: 'Мед із власної пасіки', quantity: 1, unit: 'litre', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', status: 'active' };
      const baseRequest = { title: 'Куплю мед натуральний', description: 'Потрібен мед у відрах', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Київ' };
      try {
        expect((await seller.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201);
        const badProduct = await seller.post('/api/products').send({ ...baseProduct, categoryId: auto });
        expect(badProduct.status).toBe(422);
        expect(badProduct.body).toMatchObject({ error: 'CATEGORY_MISMATCH', suggestions: [{ id: honey }] });
        const badRequest = await seller.post('/api/buy-requests').send({ ...baseRequest, categoryId: auto });
        expect(badRequest.status).toBe(422);
        const recommended = await seller.post('/api/categories/recommend').send({ title: baseProduct.title, description: baseProduct.description, categoryId: auto });
        expect(recommended.body.level).toBe('block');
        const durations: number[] = [];
        for (let index = 0; index < 20; index++) {
          const started = performance.now();
          await assessCategory({ title: baseProduct.title, description: baseProduct.description, categoryId: auto });
          durations.push(performance.now() - started);
        }
        durations.sort((a, b) => a - b);
        console.info(`Step 16 local classifier latency: median=${durations[10].toFixed(1)}ms p95=${durations[18].toFixed(1)}ms (warm category cache, 20 calls)`);
        const appeal = await seller.post('/api/category-appeals').send({ targetType: 'product', categoryId: auto, title: baseProduct.title, description: baseProduct.description });
        expect(appeal.status).toBe(201);
        expect((await seller.post('/api/category-appeals').send({ targetType: 'product', targetId: 'invalid-id', categoryId: auto, title: baseProduct.title })).status).toBe(400);
        expect((await seller.post('/api/category-appeals').send({ targetType: 'product', categoryId: auto, title: baseProduct.title, description: baseProduct.description })).status).toBe(409);
        const created = await seller.post('/api/products').send({ ...baseProduct, categoryId: honey });
        expect(created.status).toBe(201);
        const productId = created.body.product.id;
        expect((await seller.patch(`/api/products/${productId}`).send({ categoryId: auto })).status).toBe(422);
        expect((await seller.patch(`/api/products/${productId}`).send({ price: 110 })).status).toBe(200);
        expect((await seller.get(`/api/products/${productId}`)).body.product.category.id).toBe(honey);
        const draft = await seller.post('/api/products').send({ ...baseProduct, categoryId: auto, status: 'draft' });
        expect(draft.status).toBe(201);
        expect((await seller.patch(`/api/products/${draft.body.product.id}`).send({ status: 'active' })).status).toBe(422);
        const createdRequest = await seller.post('/api/buy-requests').send({ ...baseRequest, categoryId: honey });
        expect(createdRequest.status).toBe(201);
        const requestId = createdRequest.body.buyRequest.id;
        expect((await seller.patch(`/api/buy-requests/${requestId}`).send({ categoryId: auto })).status).toBe(422);
        expect((await seller.get(`/api/buy-requests/${requestId}`)).body.buyRequest.category.id).toBe(honey);
        expect((await other.post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія' })).status).toBe(401);
        const report = await seller.post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія', details: 'Прошу перевірити' });
        expect(report.status).toBe(201);
        expect((await seller.post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія' })).status).toBe(409);
        expect(JSON.stringify((await request(app).get(`/api/products/${productId}`)).body)).not.toContain('Прошу перевірити');
        const ambiguous = { ...baseProduct, title: `Насос універсальний ${suffix}`, description: 'Одна комплектація', unit: 'piece' };
        const duplicateCategories = ['market-electronics', 'market-fashion', 'market-auto', 'market-hobbies'];
        for (const [index, code] of duplicateCategories.entries()) {
          const response = await seller.post('/api/products').send({ ...ambiguous, categoryId: id(code) });
          expect(response.status).toBe(index === 3 ? 409 : 201);
          if (index === 1) expect(response.body.duplicate.existing).toHaveLength(1);
        }
      } finally {
        await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]);
      }
    }, 60_000);
  });
} else describe.skip('category validation requires DATABASE_URL', () => {});
