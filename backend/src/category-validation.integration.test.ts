import { describe, expect, it } from 'vitest';
import request from 'supertest';

if (process.env.DATABASE_URL) {
  const { createApp } = await import('./app.js');
  const { pool } = await import('./db/client.js');

  describe('safe category flow through real PostgreSQL and API', () => {
    it('publishes Product and Buy Request with suggestions, warnings and real validation', async () => {
      const suffix = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const username = `s16_${suffix}`, otherUsername = `s16o_${suffix}`;
      const app = createApp(), seller = request.agent(app), other = request.agent(app);
      const categories = (await request(app).get('/api/categories')).body.categories as { id: string; code: string }[];
      const id = (code: string) => {
        const category = categories.find(item => item.code === code);
        expect(category, code).toBeDefined();
        return category!.id;
      };
      const auto = id('market-auto--lehkovi-avtomobili'), honey = id('honey_raw');
      const baseProduct = { description: 'Оголошення для перевірки категорії', quantity: 1, unit: 'piece', price: 100, currency: 'UAH', deliveryMode: 'pickup', geoZone: 'Київ', status: 'active' };
      const baseRequest = { description: 'Запит для перевірки категорії', quantity: 1, unit: 'piece', currency: 'UAH', geoArea: 'Київ' };
      const valid = [
        ['Килимки автомобіля Toyota', 'market-auto-parts--aksesuary-dlya-avto--avtomobilni-kylymky'],
        ['Автомобільний чохол Toyota', 'market-auto-parts--aksesuary-dlya-avto--chokhly-tenty-ta-nakydky'],
        ['Фара автомобіля Ford', 'market-auto-parts--avtozapchastyny--fary-ta-osvitlennya'],
        ['Запчастини автомобіля Toyota', 'market-auto-parts--avtozapchastyny'],
        ['Іграшковий автомобіль', 'market-children--ihrashky--ihrashkovyy-transport'],
        ['Медичний халат для ляльки', 'market-children--ihrashky--lyalky-ta-pupsy'],
        ['Яблука з велосипедом у подарунок', 'apples'],
      ] as const;
      const wrong = [
        ['Мед натуральний', auto],
        ['Яблука Гала', auto],
        ['Смартфон Samsung', honey],
        ['Диван кутовий', honey],
      ] as const;
      try {
        expect((await seller.post('/api/auth/register').send({ username, email: `${username}@example.com`, countryCode: 'UA', phone: '+38050' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201);
        const owner = (await pool.query<{ id: string }>('SELECT id FROM users WHERE username_normalized = $1', [username.toLowerCase()])).rows[0].id;
        for (const [title, categoryCode] of valid) {
          const categoryId = id(categoryCode);
          const recommendation = await seller.post('/api/categories/recommend').send({ title, categoryId });
          expect(recommendation.status).toBe(200);
          expect(recommendation.body.level).not.toBe('block');
          expect(recommendation.body.suggestions.length).toBeLessThanOrEqual(3);
          const product = await seller.post('/api/products').send({ ...baseProduct, title, categoryId });
          expect(product.status, title + ' Product: ' + JSON.stringify(product.body)).toBe(201);
          expect(product.body.product.category.id).toBe(categoryId);
          const buyRequest = await seller.post('/api/buy-requests').send({ ...baseRequest, title, categoryId });
          expect(buyRequest.status, title + ' Buy Request: ' + JSON.stringify(buyRequest.body)).toBe(201);
          expect(buyRequest.body.buyRequest.category.id).toBe(categoryId);
        }
        for (const [title, categoryId] of wrong) {
          const recommendation = await seller.post('/api/categories/recommend').send({ title, categoryId });
          expect(recommendation.status).toBe(200);
          expect(recommendation.body).toMatchObject({ level: 'warn' });
          expect(recommendation.body.suggestions.length).toBeGreaterThan(0);
          const product = await seller.post('/api/products').send({ ...baseProduct, title, categoryId });
          expect(product.status, title + ' Product: ' + JSON.stringify(product.body)).toBe(201);
          expect(product.body.categoryWarning.level).toBe('warn');
          const buyRequest = await seller.post('/api/buy-requests').send({ ...baseRequest, title, categoryId });
          expect(buyRequest.status, title + ' Buy Request: ' + JSON.stringify(buyRequest.body)).toBe(201);
          expect(buyRequest.body.categoryWarning.level).toBe('warn');
        }
        expect((await pool.query('SELECT id FROM category_block_decisions WHERE user_id = $1', [owner])).rowCount).toBe(0);
        const uncertain = await seller.post('/api/categories/recommend').send({ title: 'Насос 12В', categoryId: auto });
        expect(uncertain.body).toMatchObject({ level: 'allow', certainty: 'uncertain' });
        const nonexistent = '00000000-0000-4000-8000-000000000000';
        expect((await seller.post('/api/products').send({ ...baseProduct, title: 'Невідома категорія товару', categoryId: nonexistent })).body.error).toBe('CATEGORY_NOT_AVAILABLE');
        expect((await seller.post('/api/buy-requests').send({ ...baseRequest, title: 'Невідома категорія запиту', categoryId: nonexistent })).body.error).toBe('CATEGORY_NOT_AVAILABLE');
        const created = await seller.post('/api/products').send({ ...baseProduct, title: 'Мед натуральний окремий товар', categoryId: honey });
        expect(created.status).toBe(201);
        const productId = created.body.product.id;
        const changed = await seller.patch('/api/products/' + productId).send({ categoryId: auto });
        expect(changed.status).toBe(200);
        expect(changed.body.categoryWarning.level).toBe('warn');
        expect(changed.body.product.category.id).toBe(auto);
        expect((await seller.patch('/api/products/' + productId).send({ categoryId: nonexistent })).status).toBe(400);
        expect((await seller.get('/api/products/' + productId)).body.product.category.id).toBe(auto);
        const createdRequest = await seller.post('/api/buy-requests').send({ ...baseRequest, title: 'Мед натуральний для закупівлі', categoryId: honey });
        expect(createdRequest.status).toBe(201);
        const requestId = createdRequest.body.buyRequest.id;
        const changedRequest = await seller.patch('/api/buy-requests/' + requestId).send({ categoryId: auto });
        expect(changedRequest.status).toBe(200);
        expect(changedRequest.body.categoryWarning.level).toBe('warn');
        expect((await seller.patch('/api/buy-requests/' + requestId).send({ categoryId: nonexistent })).status).toBe(400);
        expect((await seller.get('/api/buy-requests/' + requestId)).body.buyRequest.category.id).toBe(auto);
        const draft = await seller.post('/api/products').send({ ...baseProduct, title: 'Мед із тестової пасіки', categoryId: auto, status: 'draft' });
        expect(draft.status).toBe(201);
        const published = await seller.patch('/api/products/' + draft.body.product.id).send({ status: 'active' });
        expect(published.status).toBe(200);
        expect(published.body.categoryWarning.level).toBe('warn');
        expect((await request(app).post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія' })).status).toBe(401);
        const report = await seller.post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія', details: 'Прошу перевірити' });
        expect(report.status).toBe(201);
        expect(report.body.report.status).toBe('open');
        expect((await pool.query('SELECT status FROM reports WHERE id = $1', [report.body.report.id])).rows[0].status).toBe('open');
        expect((await seller.post('/api/reports').send({ targetType: 'product', targetId: productId, reason: 'Неправильна категорія' })).status).toBe(409);
        expect((await seller.post('/api/reports').send({ targetType: 'buy_request', targetId: requestId, reason: 'Неправильна категорія' })).status).toBe(201);
        expect(JSON.stringify((await request(app).get('/api/products/' + productId)).body)).not.toContain('Прошу перевірити');
        expect((await other.post('/api/auth/register').send({ username: otherUsername, email: otherUsername + '@example.com', countryCode: 'UA', phone: '+38067' + suffix.slice(-7), password: 'StrongPassword1', passwordConfirmation: 'StrongPassword1' })).status).toBe(201);
        expect((await other.patch('/api/products/' + productId).send({ price: 110 })).status).toBe(404);
        expect((await other.patch('/api/buy-requests/' + requestId).send({ title: 'Чужий запит' })).status).toBe(404);
        const duplicateBase = { ...baseProduct, title: 'Кабель універсальний ' + suffix, description: 'Однаковий опис', categoryId: id('market-electronics') };
        const duplicateCategories = ['market-electronics', 'market-fashion', 'market-auto', 'market-hobbies'];
        for (const [index, code] of duplicateCategories.entries()) {
          const response = await seller.post('/api/products').send({ ...duplicateBase, categoryId: id(code) });
          expect(response.status).toBe(index === 3 ? 409 : 201);
        }
        expect((await seller.post('/api/products').send({ ...duplicateBase, title: duplicateBase.title + '!', categoryId: id('market-hobbies') })).status).toBe(409);
        // Historical decisions remain appealable even though new semantic decisions are not created.
        const historical = await pool.query<{ id: string }>(
          "INSERT INTO category_block_decisions (user_id, target_type, category_id, title, description, reason, rules_version) VALUES ($1, 'product', $2, 'Історичне рішення', '', 'Історичне блокування', 'step16-subject-relations-v3') RETURNING id",
          [owner, auto],
        );
        const decisionId = historical.rows[0].id;
        expect((await other.post('/api/category-appeals').send({ decisionId })).status).toBe(404);
        const appeal = await seller.post('/api/category-appeals').send({ decisionId });
        expect(appeal.status).toBe(201);
        expect((await pool.query('SELECT status FROM category_block_decisions WHERE id = $1', [decisionId])).rows[0].status).toBe('appealed');
        expect((await seller.post('/api/category-appeals').send({ decisionId })).status).toBe(409);
      } finally {
        await pool.query('DELETE FROM users WHERE username_normalized = $1', [otherUsername.toLowerCase()]);
        await pool.query('DELETE FROM users WHERE username_normalized = $1', [username.toLowerCase()]);
      }
    }, 120_000);
  });
} else describe.skip('category validation requires DATABASE_URL', () => {});
