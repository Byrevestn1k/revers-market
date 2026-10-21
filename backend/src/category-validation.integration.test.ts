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
      const otherUsername = username + '_other';
      const categories = (await request(app).get('/api/categories')).body.categories;
      const id = (code: string) => categories.find((item: { code: string }) => item.code === code).id;
      const honey = id('honey_raw'), auto = id('market-auto--lehkovi-avtomobili');
      const baseProduct = { title: 'Мед натуральний 3 літри', description: 'Мед із власної пасіки', quantity: 1, unit: 'litre', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', status: 'active' };
      const baseRequest = { title: 'Куплю мед натуральний', description: 'Потрібен мед у відрах', quantity: 1, unit: 'kg', currency: 'UAH', geoArea: 'Київ' };
      try {
        expect((await seller.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201);
        const badProduct = await seller.post('/api/products').send({ ...baseProduct, categoryId: auto });
        expect(badProduct.status).toBe(422);
        expect(badProduct.body).toMatchObject({ error: 'CATEGORY_MISMATCH', suggestions: [{ id: honey }], decisionId: expect.any(String) });
        const decision = await pool.query('SELECT user_id, target_type, category_id, reason, rules_version, status FROM category_block_decisions WHERE id = $1', [badProduct.body.decisionId]);
        expect(decision.rows[0]).toMatchObject({ target_type: 'product', category_id: auto, status: 'blocked', rules_version: 'step16-context-v2' });
        const repeatedDecision = await seller.post('/api/products').send({ ...baseProduct, categoryId: auto });
        expect(repeatedDecision.status).toBe(422);
        expect(repeatedDecision.body.decisionId).toBe(badProduct.body.decisionId);
        const badRequest = await seller.post('/api/buy-requests').send({ ...baseRequest, categoryId: auto });
        expect(badRequest.status).toBe(422);
        expect(badRequest.body.decisionId).toEqual(expect.any(String));
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
        const appeal = await seller.post('/api/category-appeals').send({ decisionId: badProduct.body.decisionId });
        expect(appeal.status).toBe(201);
        expect(appeal.body.appeal.decisionId).toBe(badProduct.body.decisionId);
        expect((await pool.query('SELECT status FROM category_block_decisions WHERE id = $1', [badProduct.body.decisionId])).rows[0].status).toBe('appealed');
        expect((await seller.post('/api/category-appeals').send({ decisionId: 'invalid-id' })).status).toBe(400);
        expect((await seller.post('/api/category-appeals').send({ decisionId: badProduct.body.decisionId })).status).toBe(409);
        expect((await other.post('/api/category-appeals').send({ decisionId: badProduct.body.decisionId })).status).toBe(401);
        expect((await other.post('/api/auth/register').send({ username: otherUsername, email: otherUsername + '@example.com',
          countryCode: 'UA', phone: '+38067' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201);
        expect((await other.post('/api/category-appeals').send({ decisionId: badProduct.body.decisionId })).status).toBe(404);
        const created = await seller.post('/api/products').send({ ...baseProduct, categoryId: honey });
        expect(created.status).toBe(201);
        const productId = created.body.product.id;
        const blockedEdit = await seller.patch('/api/products/' + productId).send({ categoryId: auto });
        expect(blockedEdit.status).toBe(422);
        expect((await pool.query('SELECT target_id FROM category_block_decisions WHERE id = $1', [blockedEdit.body.decisionId])).rows[0].target_id).toBe(productId);
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
        expect((await request(app).post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія' })).status).toBe(401);
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
        expect((await seller.post('/api/products').send({ ...ambiguous, title: ambiguous.title + '!', categoryId: id(duplicateCategories[3]) })).status).toBe(409);
        const parallel = await Promise.all(duplicateCategories.map(code => seller.post('/api/products').send({
          ...ambiguous, title: 'Кабель універсальний ' + suffix, description: 'Однаковий окремий тест', categoryId: id(code),
        })));
        expect(parallel.map(response => response.status).sort()).toEqual([201, 201, 201, 409]);
        expect((await seller.post('/api/products').send({ ...baseProduct, title: 'Іграшковий автомобіль Toyota', categoryId: id('market-children--ihrashky--ihrashkovyy-transport') })).status).toBe(201);
        expect((await seller.post('/api/products').send({ ...baseProduct, title: 'Яблука Гала 5 кг', description: 'Яблука свіжого врожаю', categoryId: auto })).status).toBe(422);
        expect((await seller.post('/api/products').send({ ...baseProduct, title: 'Медичний халат для ляльки', categoryId: id('market-children--ihrashky--lyalky-ta-pupsy') })).status).toBe(201);
        await pool.query("INSERT INTO category_block_decisions (user_id, target_type, category_id, title, description, reason, rules_version) SELECT $1, 'product', $2, 'rate limit test ' || n, '', 'test', 'step16-context-v2' FROM generate_series(1, 60) AS n", [decision.rows[0].user_id, auto]);
        const rateLimited = await seller.post('/api/products').send({ ...baseProduct, title: `Мед натуральний ${suffix} rate limit`, categoryId: auto });
        expect(rateLimited.status).toBe(429);
      } finally {
        await pool.query('DELETE FROM users WHERE username_normalized = $1', [otherUsername.toLowerCase()]);
        await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]);
      }
    }, 60_000);
  });
} else describe.skip('category validation requires DATABASE_URL', () => {});
